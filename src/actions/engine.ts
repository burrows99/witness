import * as fs from "node:fs";
import * as path from "node:path";

import type { Page } from "@playwright/test";

import { requirePlaywright } from "../browser/playwright.ts";

import { fill } from "../config/index.ts";
import type { Evidence } from "../evidence/evidence.ts";
import { describe, type LocatorSpec, locate } from "../browser/locator.ts";
import { caption as drawCaption, slide as drawSlide } from "../browser/narration.ts";
import type { Operations } from "../http/operations.ts";
import type { Queries } from "../database/queries.ts";
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
  private readonly queries: Queries;
  private readonly trace: Trace;
  private readonly config: Record<string, ActionConfig>;
  private readonly appUrl: (app: string, route: string, params: Params) => string;
  private readonly evidence: () => Evidence;

  constructor(opts: {
    operations: Operations;
    queries: Queries;
    trace: Trace;
    actions: Record<string, ActionConfig>;
    url: (app: string, route: string, params: Params) => string;
    evidence: () => Evidence;
  }) {
    this.operations = opts.operations;
    this.queries = opts.queries;
    this.trace = opts.trace;
    this.config = opts.actions;
    this.appUrl = opts.url;
    this.evidence = opts.evidence;
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
  async run<T = unknown>(name: string, page: Page, inputs: Params = {}): Promise<ActionResult<T>> {
    const action = this.config[name];
    if (!action) throw new Error(`no such action "${name}" — see the config's actions`);

    const started = Date.now();
    const mark = this.trace.mark();
    const values: Params = { ...inputs };
    const steps: StepResult[] = [];
    const screenshots: string[] = [];
    const network: NetworkRecord[] = [];
    const logs: { type: string; text: string }[] = [];

    const onRequest = (req: import("@playwright/test").Request): void => void req;
    const onResponse = (res: import("@playwright/test").Response): void => {
      const req = res.request();
      network.push({ method: req.method(), url: res.url(), status: res.status(), resourceType: req.resourceType() });
    };
    const onConsole = (msg: import("@playwright/test").ConsoleMessage): void => {
      logs.push({ type: msg.type(), text: msg.text() });
    };
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("console", onConsole);

    let error: string | undefined;
    try {
      for (const [index, step] of action.steps.entries()) {
        const at = Date.now();
        const label = Object.keys(step).find(k => k !== "as" && k !== "store" && k !== "note") ?? "step";
        try {
          await this.step(step, page, values, action.app);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        const shot = await this.frame(page, name, index, label);
        if (shot) screenshots.push(shot);
        steps.push({ step: label, detail: step.note ?? describe(this.target(step) ?? ""), ms: Date.now() - at, error, screenshot: shot });
        this.trace.add({
          kind: "step",
          action: name,
          step: label,
          detail: step.note,
          ms: Date.now() - at,
          screenshot: shot,
          error,
          at: new Date().toISOString(),
        });
        if (error) break;
      }
    } finally {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("console", onConsole);
    }

    // Only ask for the declared return if the steps got that far: a failed action reporting "missing
    // {moduleId}" hides the step that actually broke, which is the one worth reading.
    const value = error
      ? (undefined as unknown as T)
      : action.returns
        ? (fill(action.returns, values) as unknown as T)
        : (values as unknown as T);
    const result: ActionResult<T> = {
      action: name,
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
      trace: this.trace.since(mark),
      error,
    };
    if (error) throw Object.assign(new Error(`action "${name}" failed at step ${steps.length}: ${error}`), { result });
    return result;
  }

  /** One step. Every branch is a verb a config can use; there is deliberately no escape into code. */
  private async step(step: StepConfig, page: Page, values: Params, defaultApp?: string): Promise<void> {
    const at = (spec: LocatorSpec): ReturnType<typeof locate> => locate(page, this.resolve(spec, values) as LocatorSpec);
    const text = (s?: string): string => (s === undefined ? "" : fill(s, values));

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
    }
    if (step.store) {
      const target = at(step.store.from);
      values[step.store.as] = (await target.textContent())?.trim() ?? "";
    }
    if (step.waitForUrl) await page.waitForURL(new RegExp(text(step.waitForUrl)), { timeout: 60_000 });
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.caption) await drawCaption(page, text(step.caption.text), step.caption.sub ? text(step.caption.sub) : undefined);
    if (step.slide) await drawSlide(page, text(step.slide.title), (step.slide.lines ?? []).map(text));
    if (step.api) {
      const params = { ...values, ...this.resolveParams(step.api.params, values) };
      const body = step.api.body ? (this.resolve(step.api.body, values) as Record<string, unknown>) : undefined;
      const answer = await this.operations.call(step.api.operation, params, body);
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
    // An action can be built from other actions — the small ones stay usable on their own, which is what
    // a spec needs when the thing under test is halfway through a flow.
    if (step.run) {
      const nested = await this.run(step.run, page, values);
      Object.assign(values, nested.values);
    }
    if (step.query) {
      const answer = this.queries.query(step.query.name, { ...values, ...this.resolveParams(step.query.params, values) });
      if (step.query.as) values[step.query.as] = answer;
    }
  }

  /** The locator a step is about, for the trace line. */
  private target(step: StepConfig): LocatorSpec | undefined {
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
  private resolve(value: unknown, values: Params): unknown {
    if (typeof value === "string") {
      const whole = value.match(/^\{(\w+)\}$/);
      if (whole && values[whole[1]] !== undefined) return values[whole[1]];
      return fill(value, values);
    }
    if (Array.isArray(value)) return value.map(v => this.resolve(v, values));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.resolve(v, values)]));
    }
    return value;
  }

  private resolveParams(params: Record<string, string> | undefined, values: Params): Params {
    return params ? (this.resolve(params, values) as Params) : {};
  }

  /**
   * A frame per step: what the screen looked like at that moment, for whoever reads the result.
   *
   * Filed with the TEST that ran the action, not in a pile of action names — the same action run by two
   * specs would otherwise overwrite itself, and the frames would belong to nothing in particular.
   */
  private async frame(page: Page, action: string, index: number, label: string): Promise<string | undefined> {
    try {
      return await this.evidence().actionFrame(page, action, index + 1, label);
    } catch {
      return undefined;
    }
  }
}

/** Action inputs and stored values: whatever the caller passes, and whatever steps read back. */
export type Params = Record<string, unknown>;

export type StepConfig = {
  /** A human note for the trace, when the verb alone does not say why. */
  note?: string;
  goto?: { app?: string; route?: string; url?: string; params?: Record<string, string> };
  click?: LocatorSpec;
  fill?: { on: LocatorSpec; value: string };
  type?: { on: LocatorSpec; value: string; delay?: number };
  press?: string;
  /** Fill a set of labelled fields: `{ "Heading": "…", "Body": "…" }`. */
  fillFields?: unknown;
  /** Scope for `fillFields` — usually the dialog the form is in. */
  within?: LocatorSpec;
  /** Wait for a response and store something from its body. */
  capture?: { url: string; method?: string; as: string; pick?: string; timeout?: number };
  /** Pick one item out of a stored list by matching fields. */
  select?: { from: string; where: Record<string, string>; pick?: string; as: string };
  /** Another action, run here with the values collected so far. */
  run?: string;
  expect?: {
    on: LocatorSpec;
    state?: "visible" | "hidden";
    text?: string;
    count?: number;
    timeout?: number;
    /** Why this must hold — it becomes the failure message. */
    because?: string;
  };
  store?: { from: LocatorSpec; as: string };
  waitForUrl?: string;
  wait?: number;
  caption?: { text: string; sub?: string };
  slide?: { title: string; lines?: string[] };
  api?: { operation: string; params?: Record<string, string>; body?: unknown; as?: string; pick?: string };
  query?: { name: string; params?: Record<string, string>; as?: string };
  as?: string;
};

export type ActionConfig = {
  summary?: string;
  /** Which app's routes `goto` steps resolve against, when they do not name one. */
  app?: string;
  inputs?: string[];
  steps: StepConfig[];
  /** A template built from the stored values — what the caller gets back as `value`. */
  returns?: string;
};

export type StepResult = { step: string; detail?: string; ms: number; error?: string; screenshot?: string };
export type NetworkRecord = { method: string; url: string; status: number; resourceType: string };

export type ActionResult<T = unknown> = {
  action: string;
  ok: boolean;
  ms: number;
  inputs: Params;
  /** The action's declared return, or every stored value if it declares none. */
  value: T;
  values: Params;
  steps: StepResult[];
  screenshots: string[];
  /** Every request the BROWSER made while the action ran — the network tab, as data. */
  network: NetworkRecord[];
  console: { type: string; text: string }[];
  /** Every request and statement the HARNESS made, with bodies. */
  trace: TraceEntry[];
  error?: string;
};
