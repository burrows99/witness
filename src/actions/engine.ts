import * as fs from "node:fs";
import * as path from "node:path";

import type { Page } from "@playwright/test";

import { requirePlaywright } from "../browser/playwright.ts";

import { fill, reach } from "../config/index.ts";
import type { Evidence } from "../evidence/evidence.ts";
import { describe, type LocatorSpec, locate } from "../browser/locator.ts";
import { slug } from "../evidence/paths.ts";
import { caption as drawCaption, slide as drawSlide } from "../browser/narration.ts";
import type { Operations } from "../http/operations.ts";
import type { Queries } from "../database/queries.ts";
import { Inspector, type Recording } from "../diagnostics/inspector.ts";
import { Story } from "../diagnostics/story.ts";
import { Trace, type TraceEntry } from "../diagnostics/trace.ts";

/**
 * Actions: what a product can DO, written as data.
 *
 * A screen is a route and an operation is a request — both already live in the config. An action is the
 * third thing: a sequence a person performs, like authoring a module in an ops portal or paying with a
 * test card. Those were the last thing left in code, and most of them are only clicks, fills and waits
 * with the odd request in the middle, which is exactly what a step list expresses.
 *
 * What comes back is not a boolean. Every step is recorded with its timing, a frame is captured after
 * each one, and every request the browser made during the action is attached — so whoever reads the
 * result (an agent, or a person reading CI) sees the network exchange and the screen at each moment
 * rather than "it failed".
 */
export class Actions {
  private readonly operations: Operations;
  /** The other services that answer. A stack has more than one. */
  private readonly client: (name: string) => Operations;
  private readonly queries: Queries;
  private readonly trace: Trace;
  private readonly config: Record<string, ActionConfig>;
  private readonly appUrl: (app: string, route: string, params: Params) => string;
  private readonly evidence: () => Evidence;
  /** A declared credential, resolved when a step actually asks for one, in its service's scope first. */
  private readonly secret: (name: string, scope?: string) => string;


  constructor(opts: {
    operations: Operations;
    /** Anything else that answers, by the name of the service that does. */
    client?: (name: string) => Operations;
    queries: Queries;
    trace: Trace;
    actions: Record<string, ActionConfig>;
    url: (app: string, route: string, params: Params) => string;
    evidence: () => Evidence;
    /** Optional: without it, `{secret.x}` says the config declares no secrets. */
    secret?: (name: string, scope?: string) => string;
  }) {
    this.operations = opts.operations;
    this.client = opts.client ?? (name => {
      throw new Error(`api step names client "${name}", and this system was built without any`);
    });
    this.queries = opts.queries;
    this.trace = opts.trace;
    this.config = opts.actions;
    this.appUrl = opts.url;
    this.evidence = opts.evidence;
    this.secret = opts.secret ?? ((name: string) => {
      throw new Error(`{secret.${name}} — this system was built without any way to resolve secrets`);
    });
  }

  /**
   * The values a template is filled from: what the run gathered, plus `secret.<name>`.
   *
   * A credential must reach a `type` step without ever becoming a stored VALUE: `values` is returned
   * to the caller and printed as JSON by the command line, so a secret kept there is a password on
   * somebody's terminal. This is resolved at the moment a template asks for it and kept nowhere.
   *
   * Lazily, through a proxy, because a config declares secrets it does not always use — and reading
   * one means an exec into a running container, which fails when that container is not the point.
   */
  private bag(values: Params, scope?: string): Params {
    return {
      ...values,
      // `{secret.adminKey}` in one of grafana's actions means grafana's, and falls back to a shared
      // one — which is how a description says "this service's credential" and "our one CI token"
      // without inventing a naming convention for either.
      secret: new Proxy({}, { get: (_, name) => (typeof name === "string" ? this.secret(name, scope) : undefined) }),
    };
  }

  /** `signIn` inside `grafana.openDashboards` is `grafana.signIn`, if there is one. */
  private resolveName(name: string, from?: string): string {
    if (this.config[name] || !from) return name;
    const service = from.includes(".") ? from.slice(0, from.indexOf(".")) : undefined;
    const scoped = service ? `${service}.${name}` : name;
    return this.config[scoped] ? scoped : name;
  }

  get names(): string[] {
    return Object.keys(this.config);
  }

  /**
   * Run one action.
   *
   * `inputs` fill `{placeholders}` in every step; anything a step stores becomes available to the steps
   * after it, so a value read off the screen (a chosen time, a created id) can be asserted or returned.
   */
  async run<T = unknown>(name: string, page: Page, inputs: Params = {}, within: Within = {}): Promise<ActionResult<T>> {
    const { from, quiet } = within;
    // Per RUN, not per engine: two actions driving two browsers at once would otherwise interleave
    // their warnings into each other's results, and the one instance is shared by both.
    const running: Running = { notices: [] };
    // A service's own action reaches its siblings by bare name — being under the same service is what
    // says which `signIn` is meant, and repeating the prefix inside it says nothing new.
    const resolved = this.resolveName(name, from);
    const action = this.config[resolved];
    if (!action) {
      throw new Error(
        `no such action "${name}"${from && resolved !== name ? ` (tried "${resolved}" too)` : ""} — ` +
          `declared: ${this.names.join(", ") || "none"}`,
      );
    }
    name = resolved;
    // Where this action's evidence goes. A composed action lives INSIDE the step that ran it, so the
    // directory tree is the call tree — which is the one thing a flat `actions/` folder could not say,
    // and the reason nothing on disk showed that `theWholeProduct` ran the eight beside it.
    const into = within.at ?? slug(name, 64);

    // Checked before anything is launched: an action that declares what it needs should say so at the
    // start, not fail on an unfilled `{placeholder}` three steps in, after a browser has opened and a
    // page has loaded. The message is the same whether a spec or a shell asked.
    const missing = (action.inputs ?? []).filter(input => inputs[input] === undefined);
    if (missing.length) {
      throw new Error(
        `action "${name}" needs ${missing.map(m => `\`${m}\``).join(", ")}` +
          `${Object.keys(inputs).length ? ` — given ${Object.keys(inputs).map(k => `\`${k}\``).join(", ")}` : " — given nothing"}`,
      );
    }

    const started = Date.now();
    const mark = this.trace.mark();
    const values: Params = { ...inputs };
    const steps: StepResult[] = [];
    const screenshots: string[] = [];
    const network: NetworkRecord[] = [];
    const logs: { type: string; text: string }[] = [];
    let recording: Recording = { requests: [], console: [], errors: [], dropped: 0 };

    // The network tab, the console tab and the exceptions — recorded through Playwright's own page
    // events, and tagged with the step that was running when each one happened.
    const inspector = new Inspector(page);

    let error: string | undefined;
    try {
      for (const [index, step] of action.steps.entries()) {
        const at = Date.now();
        const label = Actions.verb(step);
        // A composed action's every request was tagged `run`, which is the one tag that says nothing:
        // the whole promise here is that traffic is tied to the step it belongs to, and eight screens
        // of a walk all reading "run" is that promise not kept.
        inspector.mark(label === "run" ? `run ${Actions.about(step)}` : label, index);
        try {
          await this.step(step, page, values, action.app, name, { at: into, index, quiet }, running);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        // Not for a `run` step: the action it ran ends with a frame of that same screen, and the
        // extra one was 8 of this walk's 58 — the same page, one blog panel later.
        const shot = step.run || quiet ? undefined : await this.frame(page, into, index, label);
        if (shot) screenshots.push(shot);
        steps.push({ step: label, detail: Actions.about(step), ms: Date.now() - at, error, warning: running.warning, screenshot: shot, ran: running.ran });
        running.warning = undefined;
        running.ran = undefined;
        this.trace.add({
          kind: "step",
          action: name,
          step: label,
          detail: Actions.about(step),
          ms: Date.now() - at,
          screenshot: shot,
          error,
          at: new Date().toISOString(),
        });
        if (error) break;
      }
    } finally {
      recording = await inspector.stop();
      network.push(
        ...recording.requests.map(r => ({ method: r.method, url: r.url, status: r.status ?? 0, resourceType: r.resourceType })),
      );
      logs.push(...recording.console.map(c => ({ type: c.type, text: c.text })));
    }

    // Only ask for the declared return if the steps got that far: a failed action reporting "missing
    // {moduleId}" hides the step that actually broke, which is the one worth reading.
    const value = error
      ? (undefined as unknown as T)
      : action.returns
        ? (fill(action.returns, values) as unknown as T)
        : (values as unknown as T);
    // Before the result is built, so what it got away with is IN the result — and before the story,
    // so the story carries it too.
    if (!quiet) this.note(name, action, values, running);
    const result: ActionResult<T> = {
      action: name,
      warnings: running.notices,
      ok: !error,
      ms: Date.now() - started,
      inputs,
      value,
      values,
      steps,
      screenshots,
      // Everything the BROWSER asked for during the action, alongside everything the system itself did.
      network,
      console: logs,
      /** The same traffic with bodies, timings, failures and the step each one belongs to. */
      recording,
      trace: this.trace.since(mark),
      error,
    };

    // Written whether it passed or failed, because the run that passed is the one somebody compares
    // against when the next one does not.
    result.debug = quiet ? undefined : this.tell(result, into);
    if (error) throw Object.assign(new Error(`action "${name}" failed at step ${steps.length}: ${error}`), { result });
    return result;
  }

  /** One step. Every branch is a verb a config can use; there is deliberately no escape into code. */
  private async step(step: StepConfig, page: Page, values: Params, defaultApp?: string, owner?: string, where: StepPlace = {}, running: Running = { notices: [] }): Promise<void> {
    const at = (spec: LocatorSpec): ReturnType<typeof locate> => locate(page, this.resolve(spec, values, owner) as LocatorSpec);
    const text = (s?: string): string => (s === undefined ? "" : fill(s, this.bag(values, owner)));

    if (step.goto) {
      const { app, route, url, params } = step.goto;
      // The action's own `app` is the default, as its type says: a flow is usually about one app, and
      // repeating its name on every step is how a step ends up naming the wrong one.
      const on = app ?? defaultApp;
      if (!url && !on) throw new Error("goto names no app, and the action declares none");
      await page.goto(url ? text(url) : this.appUrl(on!, route!, { ...values, ...this.resolveParams(params, values) }));
    }
    if (step.click) await at(step.click).click();
    if (step.fill) await at(step.fill.on).fill(text(step.fill.value));
    // Typed rather than filled: these runs get recorded, and an instantly-full field reads as a bot.
    if (step.type) {
      const field = at(step.type.on);
      await field.click();
      await field.fill("");
      await field.pressSequentially(text(step.type.value), { delay: step.type.delay ?? 45 });
    }
    if (step.press) await page.keyboard.press(step.press);
    // The claim "it is still there after a reload" is one of the commonest there is, and going to the
    // same route again is a different thing: a fresh document, not the same one told to come back.
    if (step.reload) await page.reload();
    // A whole set of labelled fields at once — the shape of every "author this thing" form, where the
    // labels differ per type and the spec is the only thing that knows them.
    if (step.fillFields) {
      const fields = this.resolve(step.fillFields, values) as Record<string, string> | string;
      const pairs = typeof fields === "string" ? (JSON.parse(fields) as Record<string, string>) : fields;
      for (const [label, value] of Object.entries(pairs)) {
        // Exact label first, then a prefix: a field's label often carries a qualifier the caller has no
        // reason to know ("Holding note (results not ready)"), and an exact-only match fails on a
        // wording change that a person would not even notice.
        const candidates = [
          locate(page, { labelledInput: label, within: step.within }),
          locate(page, { labelledTextarea: label, within: step.within }),
          locate(page, { css: `label:has-text("${label}") ~ input`, within: step.within, nth: 0 }),
          locate(page, { css: `label:has-text("${label}") ~ textarea`, within: step.within, nth: 0 }),
          locate(page, { css: `label:has-text("${label}") ~ div textarea`, within: step.within, nth: 0 }),
        ];
        let target = candidates[0];
        for (const candidate of candidates) {
          if (await candidate.count()) {
            target = candidate;
            break;
          }
        }
        await target.click();
        await target.fill("");
        await target.pressSequentially(String(value), { delay: 20 });
      }
    }
    // Wait for a response and keep something out of its body — the id an app never puts on screen.
    if (step.capture) {
      const match = text(step.capture.url);
      const res = await page.waitForResponse(
        r => r.url().includes(match) && (!step.capture!.method || r.request().method() === step.capture!.method),
        { timeout: step.capture.timeout ?? 60_000 },
      );
      const body = (await res.json().catch(() => ({}))) as unknown;
      values[step.capture.as] = this.pick(body, step.capture.pick);
    }
    if (step.expect) {
      const { expect } = requirePlaywright("an `expect` step");
      const target = at(step.expect.on);
      const timeout = step.expect.timeout ?? 30_000;
      const because = step.expect.because;
      if (step.expect.state === "hidden") await expect(target, because).toBeHidden({ timeout });
      else if (step.expect.text) await expect(target, because).toContainText(text(step.expect.text), { timeout });
      else if (step.expect.count !== undefined) await expect(target, because).toHaveCount(step.expect.count, { timeout });
      else await expect(target, because).toBeVisible({ timeout });

      // The one failure mode that produces a GREEN run and a wrong deliverable: a match on a node that
      // is in the document and not in the picture. The assertion is satisfied, the frame beside it
      // shows nothing, and the caption above it claims something the evidence disproves.
      if (step.expect.state !== "hidden") running.warning = await Actions.offScreen(page, target);
    }
    if (step.store) {
      const target = at(step.store.from);
      // One element, or all of them. "What is this control offering?" is a whole class of claim — every
      // option in a picker, every row in a list — and without `all` the only answer was a strict-mode
      // violation that happened to name the count.
      values[step.store.as] = step.store.all
        ? (await target.allTextContents()).map(text => text.trim()).filter(Boolean)
        : ((await target.textContent())?.trim() ?? "");
    }
    if (step.waitForUrl) {
      const wait = typeof step.waitForUrl === "string" ? { url: step.waitForUrl } : step.waitForUrl;
      // A route rather than a literal, because the port is already declared — and `portVar` means it
      // can differ per checkout. `"localhost:3020/…"` in a step is that knob quietly disconnected.
      if (wait.route) {
        const there = this.appUrl(wait.app ?? defaultApp ?? "", wait.route, values);
        wait.url = `${there.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?(\\?.*)?$`;
      }
      await page.waitForURL(new RegExp(text(wait.url)), { timeout: wait.timeout ?? 60_000 });
    }
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.caption) await drawCaption(page, text(step.caption.text), step.caption.sub ? text(step.caption.sub) : undefined);
    if (step.slide) {
      // `kicker` and `tone` were declared, documented, and silently dropped here — a config could ask
      // for them and get a plain card with no complaint.
      await drawSlide(page, text(step.slide.title), (step.slide.lines ?? []).map(text), {
        kicker: step.slide.kicker ? text(step.slide.kicker) : undefined,
        tone: step.slide.tone,
        ms: step.slide.ms,
      });
    }
    if (step.api) {
      const params = { ...values, ...this.resolveParams(step.api.params, values) };
      const body = step.api.body ? (this.resolve(step.api.body, values) as Record<string, unknown>) : undefined;
      const answer = await (step.api.client ? this.client(step.api.client) : this.operations).call(step.api.operation, params, body);
      if (step.api.as) values[step.api.as] = this.pick(answer, step.api.pick);
    }
    // Pick one item out of something a previous step fetched — "the module we just authored", by name.
    if (step.select) {
      const raw = values[step.select.from];
      const list = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>[];
      const wanted = this.resolveParams(step.select.where, values);
      const found = list.find(item => Object.entries(wanted).every(([k, v]) => String(item[k]) === String(v)));
      if (!found) {
        throw new Error(`select: nothing in "${step.select.from}" matches ${JSON.stringify(wanted)}`);
      }
      values[step.select.as] = this.pick(found, step.select.pick);
    }
    // An action can be built from other actions — the small ones stay usable on their own, which is
    // what a caller needs when the thing being looked at is halfway through a flow.
    if (step.run) {
      const call = typeof step.run === "string" ? { action: step.run } : step.run;
      // Without `with`, the composed action could only ever be run on the values that happened to be
      // lying around — so an action taking an input could be composed once and never twice.
      // `18-browseconnections`, beside the frames of the step that ran it. The number ties the child
      // to the parent's own step list without anybody having to hold two orderings in their head.
      const step18 = String((where.index ?? 0) + 1).padStart(2, "0");
      const child = call.action.includes(".") ? call.action.slice(call.action.indexOf(".") + 1) : call.action;
      const nested = await this.run(call.action, page, { ...values, ...this.resolveParams(call.with, values, owner) }, {
        from: owner,
        at: where.at ? `${where.at}/${step18}-${slug(child, 40)}` : undefined,
        quiet: where.quiet,
      });
      running.ran = where.at ? `${where.at}/${step18}-${slug(child, 40)}` : undefined;
      Object.assign(values, nested.values);
    }
    if (step.query) {
      const answer = this.queries.query(step.query.name, { ...values, ...this.resolveParams(step.query.params, values) });
      if (step.query.as) values[step.query.as] = answer;
    }
    // The claim one layer makes against another: what the API answered against what the screen shows,
    // what a list holds against what was counted. `expect` can only see the screen, so this was the
    // last thing a description could not say and a program had to.
    if (step.check) Actions.assert(step.check, this.bag(values, owner));
    // A still worth keeping on its own, beside the automatic one per step: the frames a person is
    // actually shown, named for what they show rather than for the verb that happened to take them.
    if (step.frame) await this.evidence().frame(page, text(step.frame), { fullPage: step.fullPage });
  }

  /**
   * One `check`, against the values collected so far.
   *
   * Everything is compared as text, because everything arrives as text: a number read off a screen, a
   * number out of a JSON body and a number in the config are all strings by the time they meet. The
   * numeric comparisons parse; the rest do not need to.
   */
  private static assert(check: NonNullable<StepConfig["check"]>, values: Params): void {
    const actual = fill(check.that, values);
    const because = check.because ? `${check.because} — ` : "";
    const fail = (said: string): never => {
      throw new Error(`${because}${JSON.stringify(check.that)} is ${JSON.stringify(actual)}, ${said}`);
    };
    const number = (raw: string, name: string): number => {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) fail(`and ${name} wants a number`);
      return parsed;
    };

    if (check.equals !== undefined && actual !== fill(check.equals, values)) fail(`not ${JSON.stringify(fill(check.equals, values))}`);
    if (check.not !== undefined && actual === fill(check.not, values)) fail(`which is what it must not be`);
    if (check.contains !== undefined && !actual.includes(fill(check.contains, values))) fail(`which does not contain ${JSON.stringify(fill(check.contains, values))}`);
    if (check.matches !== undefined && !new RegExp(check.matches).test(actual)) fail(`which does not match /${check.matches}/`);
    if (check.atLeast !== undefined) {
      const want = number(fill(String(check.atLeast), values), "atLeast");
      if (number(actual, "the value") < want) fail(`which is less than ${want}`);
    }
    if (check.atMost !== undefined) {
      const want = number(fill(String(check.atMost), values), "atMost");
      if (number(actual, "the value") > want) fail(`which is more than ${want}`);
    }
  }

  /**
   * Whether what an assertion matched is actually in the frame.
   *
   * Best-effort and silent when it cannot tell: this exists to add a sentence to a story, never to fail
   * a run that the assertion itself was happy with.
   *
   * Public because it is the piece with the decision in it, and an `expect` step cannot be driven by a
   * fake — Playwright's own matchers refuse anything that is not a real Locator.
   */
  static async offScreen(page: Page, target: ReturnType<typeof locate>): Promise<string | undefined> {
    try {
      const viewport = page.viewportSize();
      if (!viewport) return undefined;
      const box = await target.first().boundingBox();
      if (!box) return "matched a node with no box on the page — the frame will not show it";
      const outside =
        box.y + box.height <= 0 || box.y >= viewport.height || box.x + box.width <= 0 || box.x >= viewport.width;
      return outside
        ? `matched a node outside the viewport (at ${Math.round(box.x)},${Math.round(box.y)} in ${viewport.width}×${viewport.height}) — it passed, and the frame does not show it`
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Keys that modify a step rather than being what it does. Everything else names the verb. */
  private static readonly MODIFIERS = ["as", "note", "within", "fullPage"];

  /**
   * What the step IS — `goto`, `click`, `store`.
   *
   * `store` used to be excluded along with the modifiers, so a step that only stores was labelled
   * "step": anonymous in the one section of the story a person reads first.
   */
  private static verb(step: StepConfig): string {
    return Object.keys(step).find(key => !Actions.MODIFIERS.includes(key)) ?? "step";
  }

  /**
   * What the step is ABOUT, in a few words.
   *
   * Never a value: a `fill` step's value is a password as often as not, and a story is a file people
   * paste into pull requests. The locator says which field; the value is nobody's business.
   */
  private static about(step: StepConfig): string | undefined {
    if (step.note) return step.note;
    if (step.reload) return "the same page, fresh";
    if (step.goto) return step.goto.url ?? step.goto.route ?? step.goto.app;
    if (step.run) return typeof step.run === "string" ? step.run : step.run.action;
    if (step.check) return step.check.because ?? step.check.that;
    if (step.frame) return step.frame;
    if (step.api) return step.api.operation;
    if (step.query) return step.query.name;
    if (step.capture) return step.capture.url;
    if (step.select) return `${step.select.from} where ${JSON.stringify(step.select.where)}`;
    if (step.press) return step.press;
    if (step.wait) return `${step.wait}ms`;
    if (step.waitForUrl) return typeof step.waitForUrl === "string" ? step.waitForUrl : (step.waitForUrl.route ?? step.waitForUrl.url);
    if (step.caption) return step.caption.text;
    if (step.slide) return step.slide.title;
    if (step.fillFields) return "a set of labelled fields";
    const target = Actions.target(step);
    return target ? describe(target) : undefined;
  }

  /** The locator a step is about, for the trace line. */
  private static target(step: StepConfig): LocatorSpec | undefined {
    return step.click ?? step.fill?.on ?? step.type?.on ?? step.expect?.on ?? step.store?.from;
  }

  private pick(answer: unknown, path?: string): string {
    if (!path) return typeof answer === "string" ? answer : JSON.stringify(answer);
    let cursor: unknown = answer;
    for (const key of path.split(".")) {
      if (Array.isArray(cursor) && /^\d+$/.test(key)) cursor = cursor[Number(key)];
      else cursor = (cursor as Record<string, unknown> | undefined)?.[key];
    }
    return typeof cursor === "string" ? cursor : JSON.stringify(cursor);
  }

  /**
   * Fill `{placeholders}` everywhere in a step's data, at any depth.
   *
   * A string that is EXACTLY one placeholder resolves to the value itself rather than its text, so a
   * step can be handed a whole object (`"fillFields": "{fields}"`) and not the string "[object Object]".
   */
  private resolve(value: unknown, values: Params, owner?: string): unknown {
    if (typeof value === "string") {
      const whole = value.match(/^\{(\w+)\}$/);
      if (whole && values[whole[1]] !== undefined) return values[whole[1]];
      return fill(value, this.bag(values, owner));
    }
    if (Array.isArray(value)) return value.map(v => this.resolve(v, values, owner));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.resolve(v, values, owner)]));
    }
    return value;
  }

  private resolveParams(params: Record<string, string> | undefined, values: Params, owner?: string): Params {
    return params ? (this.resolve(params, values, owner) as Params) : {};
  }

  /**
   * The run, told once and written down: `debug.md` for whoever reads it, `debug.json` for whatever does.
   *
   * Best-effort — a story that cannot be written must not fail the action it is about.
   */
  private tell(result: ActionResult, at: string): { markdown?: string; json?: string } {
    try {
      const evidence = this.evidence();
      const story = new Story({
        name: result.action,
        root: evidence.dir,
        ok: result.ok,
        ms: result.ms,
        steps: result.steps,
        warnings: result.warnings,
        recording: result.recording,
        trace: result.trace,
        artefacts: evidence.artefacts(),
      });
      return {
        markdown: evidence.write(`${at}/debug.md`, story.markdown()),
        json: evidence.write(`${at}/debug.json`, JSON.stringify(story.json(), null, 2)),
      };
    } catch {
      return {};
    }
  }

  /**
   * The note a person needs to re-walk this by hand, when the action asks for one.
   *
   * The instructions recommended `evidence.manualVerification()` — an API you can only reach by
   * writing code, in a tool whose whole claim is that there is no file to write. So it is a field:
   * the same note, from the description, filled with what the run gathered.
   */
  private note(name: string, action: ActionConfig, values: Params, running: Running): void {
    if (!action.verify) return;
    const { title, subject = {}, signIn = [], notes = [] } = action.verify;
    /**
     * A note is a courtesy: a template naming something no step stored must not turn a run that
     * worked into a failure. But it must not be SILENT either — dropping the line left three of four
     * notes missing from a green run, in the one file whose whole job is being trustworthy to
     * somebody who did not watch it. So the line stays, the gap is marked in it, and the run says so.
     */
    const text = (value: string): string => {
      try {
        // The same bag a step is filled from, scoped the same way: a note saying WHICH account the
        // run was about is the commonest one there is, and that account's name is usually a secret.
        return fill(value, this.bag(values, name));
      } catch (err) {
        running.notices.push(`verify: ${err instanceof Error ? err.message : String(err)}`);
        return value.replace(/\{([\w.]+)\}/g, (whole, key: string) => (reach(values, key) === undefined ? `«${key} — nothing stored that»` : whole));
      }
    };
    // Resolved first, and then available to the notes: `subject` names who the run was about, and a
    // note saying so is the commonest thing anybody writes. Stored values still win — a step that
    // read something off the screen is the more specific answer.
    const who = Object.fromEntries(Object.entries(subject).map(([key, value]) => [key, text(value)]));
    values = { ...who, ...values };

    try {
      this.evidence().manualVerification({
        title: text(title),
        subject: who,
        signIn: signIn.map(text),
        notes: notes.map(text),
      });
    } catch (err) {
      running.notices.push(`verify: the note could not be written — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * A frame per step: what the screen looked like at that moment, for whoever reads the result.
   *
   * Filed with the TEST that ran the action, not in a pile of action names — the same action run by two
   * specs would otherwise overwrite itself, and the frames would belong to nothing in particular.
   */
  private async frame(page: Page, at: string, index: number, label: string): Promise<string | undefined> {
    try {
      return await this.evidence().actionFrame(page, at, index + 1, label);
    } catch {
      return undefined;
    }
  }
}

/**
 * Where an action is being run from, and where its evidence goes.
 *
 * Internal: a caller says `run(name, page, inputs)` and gets the top of a tree. Everything here is
 * what the tree keeps track of as it goes down.
 */
export type Within = {
  /** The action whose step ran this one — how a bare name finds its sibling. */
  from?: string;
  /** The directory its frames and story go in. A composed action's is inside its caller's. */
  at?: string;
  /** Write no frames and no story: a read-only check drives the browser and should leave nothing. */
  quiet?: boolean;
};

/**
 * What one run of one action is accumulating.
 *
 * On the instance this was a bug waiting for the day two actions ran at once: one engine, one
 * `warning` field, two browsers writing to it.
 */
type Running = { warning?: string; ran?: string; notices: string[] };

/** What a step needs to know about its own position, to file what it runs underneath itself. */
type StepPlace = { at?: string; index?: number; quiet?: boolean };

/** Action inputs and stored values: whatever the caller passes, and whatever steps read back. */
export type Params = Record<string, unknown>;

export type StepConfig = {
  /** A human note for the trace, when the verb alone does not say why. */
  note?: string;
  /** Go to one of an app's declared routes, or to a URL outright. */
  goto?: { app?: string; route?: string; url?: string; params?: Record<string, string> };
  /** Click something, named the way a person would name it. */
  click?: LocatorSpec;
  /** Put a value in a field at once. Prefer `type` for anything that gets recorded. */
  fill?: { on: LocatorSpec; value: string };
  /** Type into a field, key by key: an instantly-full field reads as a bot in a video. */
  type?: { on: LocatorSpec; value: string; delay?: number };
  /** A key, on the keyboard — `Enter`, `Escape`, `Control+A`. */
  press?: string;
  /** Reload the page — for "and it is still there afterwards", which `goto` does not say. */
  reload?: boolean;
  /** Fill a set of labelled fields: `{ "Heading": "…", "Body": "…" }`. */
  fillFields?: unknown;
  /** Scope for `fillFields` — usually the dialog the form is in. */
  within?: LocatorSpec;
  /** Wait for a response and store something from its body. */
  capture?: { url: string; method?: string; as: string; pick?: string; timeout?: number };
  /** Pick one item out of a stored list by matching fields. */
  select?: { from: string; where: Record<string, string>; pick?: string; as: string };
  /**
   * Another action, run here with the values collected so far.
   *
   * `with` passes it inputs of its own — a template, so `{ "search": "{term}" }` forwards one of this
   * action's. Without it a composed action could only run on whatever happened to be lying around.
   */
  run?: string | { action: string; with?: Record<string, string> };
  /**
   * A claim about the values collected so far — the one thing `expect` cannot make.
   *
   * `expect` looks at the screen. This looks at what the run has gathered: what the API answered
   * against what the screen shows, how many rows a `store` read, whether a `query` found anything.
   * `that` is a template, so `{stats.dashboards}` and `{rows.length}` are what it is usually about.
   */
  check?: {
    that: string;
    equals?: string;
    not?: string;
    contains?: string;
    /** A REGULAR EXPRESSION the value must match. */
    matches?: string;
    atLeast?: number | string;
    atMost?: number | string;
    /** Why this must hold — it becomes the first half of the failure message. */
    because?: string;
  };
  /**
   * Keep a still of the screen right now, named for what it shows.
   *
   * Every step is photographed anyway, into the action's own directory. This is the other kind: the
   * frames somebody is going to look at, numbered in order, named "signed in" rather than "04-click".
   */
  frame?: string;
  /** For `frame`: capture below the fold. Wrong wherever the viewport itself is the claim. */
  fullPage?: boolean;
  /** Assert something is on the screen — the claim the step list exists to make. */
  expect?: {
    on: LocatorSpec;
    state?: "visible" | "hidden";
    text?: string;
    count?: number;
    timeout?: number;
    /** Why this must hold — it becomes the failure message. */
    because?: string;
  };
  /**
   * Read something off the screen and keep it for the steps after this one.
   *
   * One element by default. `all` reads every match instead, as an array — what a picker is offering,
   * what a list contains — which `expect` can then count and `select` can pick from.
   */
  store?: { from: LocatorSpec; as: string; all?: boolean };
  /**
   * Wait until the address matches this REGULAR EXPRESSION — how a flow says "and it took me there".
   *
   * A regex, not a glob: `products/\\d+` works, `**\/products/**` is a syntax error. A bare substring
   * is a valid regex and the commonest useful form.
   *
   * `route` waits for a route this description already declares, which is the form to prefer: the
   * port is in the config, `portVar` lets it differ per checkout, and a literal `localhost:3020` in a
   * step is that knob quietly disconnected.
   *
   * The object form sets how long. Worth setting whenever the wait is how the step FAILS: a rejected
   * sign-in never navigates, and the default minute is a minute of nothing per attempt.
   */
  waitForUrl?: { url?: string; route?: string; app?: string; timeout?: number } | string;
  /** Wait this many milliseconds. The last resort: prefer waiting for a thing over waiting for time. */
  wait?: number;
  /** Draw a caption into the page, so the recording says what is about to happen. */
  caption?: { text: string; sub?: string };
  /**
   * A full-frame card spliced into the video: what this section of the recording is about.
   *
   * `kicker` is the small line above the title — a cut, a step number, whose view this is. `tone`
   * colours it: `bad` for the state a change is fixing, `good` for the one it produces.
   */
  slide?: { title: string; lines?: string[]; kicker?: string; tone?: "neutral" | "bad" | "good"; ms?: number };
  /**
   * Call one of the config's declared operations, mid-flow, and keep what it answered.
   *
   * `client` names which service to ask, for a stack where more than one answers — the default is
   * the first service that declares an `api`. Without it, describing a second service's API meant
   * declaring operations nothing could reach.
   */
  api?: { operation: string; client?: string; params?: Record<string, string>; body?: unknown; as?: string; pick?: string };
  /** Run one of the config's named queries and keep the answer — what was STORED, mid-flow. */
  query?: { name: string; params?: Record<string, string>; as?: string };
  as?: string;
};

export type ActionConfig = {
  summary?: string;
  /**
   * The note a person needs to re-walk this by hand — `manual-verification.md`, beside the frames.
   *
   * Every value is a template, so it says what THIS run saw: `{orderId}`, `{stats.users}`, whatever
   * a step stored. Written whether the run passed or failed, because a failure is when someone looks.
   */
  verify?: {
    title: string;
    /** Who or what the run was about: an account, a tenant, a record. */
    subject?: Record<string, string>;
    /** How to become them — the commands that mint a session, say. */
    signIn?: string[];
    /** What the run saw, in a reader's words rather than the step list's. */
    notes?: string[];
  };
  /** Which app's routes `goto` steps resolve against, when they do not name one. */
  app?: string;
  inputs?: string[];
  steps: StepConfig[];
  /** A template built from the stored values — what the caller gets back as `value`. */
  returns?: string;
};

export type StepResult = {
  step: string;
  detail?: string;
  ms: number;
  error?: string;
  /** It passed, and something about how it passed is worth saying — see `offScreen`. */
  warning?: string;
  screenshot?: string;
  /** For a `run` step: where the action it ran put its own frames and story. */
  ran?: string;
};
export type NetworkRecord = { method: string; url: string; status: number; resourceType: string };

export type ActionResult<T = unknown> = {
  action: string;
  ok: boolean;
  ms: number;
  inputs: Params;
  /** The action's declared return, or every stored value if it declares none. */
  value: T;
  /** What it got away with. A run can be `ok` and still have something worth reading. */
  warnings: string[];
  values: Params;
  steps: StepResult[];
  screenshots: string[];
  /** Every request the BROWSER made while the action ran — the network tab, as data. */
  network: NetworkRecord[];
  console: { type: string; text: string }[];
  /** The same traffic with bodies, timings, failures, and the step each one belongs to. */
  recording: Recording;
  /** Every request and statement the HARNESS made, with bodies. */
  trace: TraceEntry[];
  /** Where the written-up version of all of this landed. */
  debug?: { markdown?: string; json?: string };
  error?: string;
};
