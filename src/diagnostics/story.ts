import type { ConsoleRecord, PageErrorRecord, Recording, RequestRecord } from "./inspector.ts";
import type { FailureWhen } from "../providers/clients.ts";
import { reach } from "../config/load.ts";
import type { TraceEntry } from "./trace.ts";

/**
 * What happened, told once, in the order a person would want it.
 *
 * Playwright already records the run better than anything hand-written could: the trace has the DOM at
 * every action, the network with bodies, the console and the sources, and `show-trace` is a real
 * debugger. None of that is reimplemented here — the story points at it.
 *
 * What none of it gives is a version an AGENT can read. A trace is a GUI; a video is pixels; a report
 * is HTML. Something driving this from a shell gets a stack trace and has to go and reconstruct, by
 * hand, the thing every developer reconstructs in their head: what was being attempted when the 500
 * came back, whether the console said anything a moment later, whether the request even left. That is
 * the one artefact missing, so that is the one this writes — with every step, request, log and
 * exception already correlated, and pointers to the tools for the human who comes next.
 */
export class Story {
  /**
   * Which resource types are the app talking, as opposed to the page loading itself.
   *
   * A single navigation in a dev server pulls forty chunks, fonts and images. Listing them next to the
   * two requests the product actually made buries the ones that matter — and the ones that matter are
   * exactly what someone opens this file for.
   */
  private static readonly TRAFFIC = ["document", "xhr", "fetch", "websocket", "eventsource"];

  /**
   * How long a body this will parse looking for a declared failure.
   *
   * The recorder clips at 4000 characters, so this is generous by four times over for anything it
   * wrote — it is here for whatever else hands a story a recording, because "the body may be huge" is
   * the one thing a renderer must not learn the hard way.
   */
  private static readonly MOST_BODY = 16_000;

  private readonly input: StoryInput;
  /** The bodies, read once. Filled on first use and never for a run that declared no marker. */
  private marked?: { failed: Map<RequestRecord, string>; unreadable: number };

  constructor(input: StoryInput) {
    this.input = input;
  }

  /** A path under the evidence directory, said the short way. */
  private short(file: string | undefined): string | undefined {
    if (!file) return undefined;
    const root = this.input.root;
    return root && file.startsWith(root) ? file.slice(root.length).replace(/^\//, "") : file;
  }

  /** The whole thing as data, for whatever wants to read it as data. */
  json(): StoryJson {
    const { name, ok, ms, steps, recording, trace = [], artefacts = {} } = this.input;
    const failure = this.failure();
    return {
      name,
      ok,
      ms,
      failure,
      steps,
      network: {
        total: recording.requests.length,
        failed: this.failed().length,
        slow: this.slow().length,
        dropped: recording.dropped,
        requests: recording.requests,
        // Which of them a declared marker caught, and which marker. The bodies round-trip whole above,
        // but what the story CONCLUDED from one cannot be worked out again without the rules that were
        // in force — and two readings of the same evidence that disagree is the failure this fixes.
        failedInBody: [...this.bodies().failed].map(([request, marker]) => ({ index: recording.requests.indexOf(request), marker })),
      },
      console: recording.console,
      pageErrors: recording.errors,
      harness: trace,
      artefacts,
    };
  }

  markdown(): string {
    const { name, ms, steps, recording, trace = [], artefacts = {} } = this.input;
    const failure = this.failure();
    const lines: string[] = [];

    lines.push(`# ${name} — ${this.headline()} (${Story.duration(ms)})`, "");

    const warned = steps.filter(step => step.warning);
    if (warned.length) {
      lines.push(
        `## ${warned.length} step${warned.length === 1 ? "" : "s"} passed in a way worth knowing about`,
        "",
        ...warned.map(step => `- \`${step.step}\` — ${step.warning}`),
        "",
      );
    }

    lines.push("## What it was doing", "");
    steps.forEach((step, index) => {
      const mark = step.error ? "✗" : "✓";
      const detail = step.detail ? ` ${step.detail}` : "";
      const shot = this.short(step.screenshot);
      // A `run` step has no frame of its own — the action it ran ends with one of that same screen —
      // so it points at where that action put everything instead.
      const where = step.ran ? ` · ${step.ran}/debug.md` : shot ? ` · ${shot}` : "";
      lines.push(`${index + 1}. ${mark} \`${step.step}\`${detail} — ${Story.duration(step.ms)}${where}`);
      // A step that passed in a way worth knowing about. Indented under it, because the reader is
      // scanning for the ✗ and would otherwise never look at a ✓ again.
      if (step.warning) lines.push(`   ⚠ ${step.warning}`);
    });
    lines.push("");

    if (failure) {
      lines.push("## Where it broke", "");
      lines.push(`Step ${failure.step}, \`${failure.label}\`:`, "", "```", failure.error, "```", "");
      if (failure.screenshot) lines.push(`The screen at that moment: \`${this.short(failure.screenshot)}\``, "");

      // The half of debugging that is otherwise three panes and a stopwatch: what the page was doing
      // while the step that failed was running.
      const during = recording.requests.filter(r => r.stepIndex === failure.index);
      const badDuring = during.filter(request => this.isFailure(request));
      const saidDuring = recording.console.filter(c => c.stepIndex === failure.index && Story.isNoisy(c));
      const threwDuring = recording.errors.filter(e => e.stepIndex === failure.index);

      lines.push("**During that step:**", "");
      lines.push(
        `- ${during.length} request${during.length === 1 ? "" : "s"}` +
          (badDuring.length ? `, **${badDuring.length} of them failed**` : ", none of which failed"),
      );
      lines.push(
        saidDuring.length
          ? `- the console said ${saidDuring.length} thing${saidDuring.length === 1 ? "" : "s"} worth reading`
          : "- the console said nothing",
      );
      if (threwDuring.length) lines.push(`- **the page threw ${threwDuring.length} uncaught error${threwDuring.length === 1 ? "" : "s"}**`);
      lines.push("");
      for (const request of badDuring.slice(0, 5)) lines.push(...this.detail(request));
      for (const message of saidDuring.slice(0, 5)) lines.push(`> \`${message.type}\` ${message.text}${message.source ? ` — ${message.source}` : ""}`, "");
      for (const error of threwDuring.slice(0, 3)) lines.push(...Story.errorDetail(error));
    }

    lines.push(...this.warnings());
    lines.push(...this.network());
    lines.push(...this.console());
    lines.push(...this.pageErrors());
    lines.push(...Story.harness(trace));
    lines.push(...this.where(artefacts));
    return lines.join("\n");
  }

  /**
   * What the run got away with.
   *
   * A run can be `ok` and still have something worth reading — a note whose template named something
   * nothing stored, an assertion that matched off-screen. Silence about those is how a green run ships
   * a `manual-verification.md` with three of its four lines missing.
   */
  private warnings(): string[] {
    const of = this.input.warnings ?? [];
    return of.length ? [`## What it got away with (${of.length})`, "", ...of.map(warning => `- ${warning}`), ""] : [];
  }

  /** The network, as a table, with the interesting ones spelled out underneath. */
  private network(): string[] {
    const { recording } = this.input;
    if (!recording.requests.length) return [];
    const failed = this.failed();
    const slow = this.slow();
    const lines = [
      `## Network (${recording.requests.length} request${recording.requests.length === 1 ? "" : "s"}` +
        `${failed.length ? ` · ${failed.length} failed` : ""}${slow.length ? ` · ${slow.length} over a second` : ""})`,
      "",
    ];
    if (recording.dropped) {
      lines.push(`_${recording.dropped} more were not recorded: the run passed the limit._`, "");
    }
    // What the app said, and what the page merely loaded. Anything that failed or crawled is traffic
    // whatever its type: an asset nobody asked about is noise until the moment it 404s.
    const traffic = recording.requests.filter(r => this.isTraffic(r));
    const assets = recording.requests.filter(r => !this.isTraffic(r));

    lines.push("| at | step | method | status | ms | url |", "|---|---|---|---|---|---|");
    for (const request of traffic) {
      lines.push(
        `| ${Story.duration(request.at)} | ${request.step} | ${request.method} | ${this.status(request)} |` +
          ` ${request.ms === undefined ? "—" : Story.duration(request.ms)} | ${Story.shorten(request.url)} |`,
      );
    }
    lines.push("");
    if (assets.length) {
      // Counted, not listed: they are in `debug.json` and in the trace if anyone needs them.
      const slowest = Math.max(...assets.map(a => a.ms ?? 0));
      lines.push(
        `_…and ${assets.length} static asset${assets.length === 1 ? "" : "s"} (scripts, styles, fonts, images) — ` +
          `all under 400, slowest ${Story.duration(slowest)}. They are in \`debug.json\`._`,
        "",
      );
    }
    // What could not be judged, said out loud. A body is clipped when it is recorded, so a long one
    // arrives as invalid JSON and a marker inside it cannot be seen — which is the same silence this
    // predicate exists to end, arriving one layer down. Only when something declared a marker: with
    // nothing to look for, an unparseable body is not a gap in anything.
    const { unreadable } = this.bodies();
    if (unreadable) {
      lines.push(
        `_${unreadable} JSON ${unreadable === 1 ? "body was" : "bodies were"} not readable back — clipped when recorded, or malformed — ` +
          `so a declared failure marker inside ${unreadable === 1 ? "it" : "them"} would not have been seen._`,
        "",
      );
    }
    if (failed.length) {
      lines.push("### The ones that failed", "");
      for (const request of failed) lines.push(...this.detail(request));
    }
    return lines;
  }

  private console(): string[] {
    const messages = this.input.recording.console;
    if (!messages.length) return [];
    const noisy = messages.filter(Story.isNoisy);
    const lines = [`## Console (${messages.length}${noisy.length ? `, ${noisy.length} of them errors or warnings` : ""})`, ""];
    // Errors and warnings first, whole; the rest as one line each, because a run that logs 200 times
    // has already told you everything it is going to.
    for (const message of noisy) {
      // Clipped: a React hydration mismatch prints a whole component tree, and a story nobody scrolls
      // to the end of has hidden the thing after it. The full text is in `debug.json`.
      lines.push(
        `- **${message.type}** during \`${message.step}\` — ${Story.shorten(message.text.replace(/\s+/g, " "), 400)}` +
          `${message.source ? ` (${message.source})` : ""}`,
      );
    }
    const rest = messages.filter(m => !Story.isNoisy(m)).slice(0, 20);
    for (const message of rest) lines.push(`- ${message.type} during \`${message.step}\` — ${Story.shorten(message.text, 160)}`);
    if (messages.length - noisy.length > rest.length) {
      lines.push(`- _…and ${messages.length - noisy.length - rest.length} more logs_`);
    }
    lines.push("");
    return lines;
  }

  private pageErrors(): string[] {
    const errors = this.input.recording.errors;
    if (!errors.length) return [];
    return [`## Uncaught in the page (${errors.length})`, "", ...errors.flatMap(Story.errorDetail)];
  }

  /** What the system itself did, as opposed to what the browser did. */
  private static harness(trace: TraceEntry[]): string[] {
    const interesting = trace.filter(entry => entry.kind !== "step");
    if (!interesting.length) return [];
    const lines = ["## What the harness itself did", ""];
    for (const entry of interesting) {
      if (entry.kind === "http") {
        lines.push(
          `- \`${entry.method} ${Story.shorten(entry.url)}\` → ${entry.status ?? "—"} (${Story.duration(entry.ms)})` +
            `${entry.operation ? ` · ${entry.operation}` : ""}${entry.error ? ` — **${entry.error}**` : ""}`,
        );
      } else if (entry.kind === "sql") {
        lines.push(`- \`${entry.query ?? "sql"}\` (${Story.duration(entry.ms)}) → ${Story.shorten(String(entry.rows), 120)}`);
      }
    }
    lines.push("");
    return lines;
  }

  private where(artefacts: Artefacts): string[] {
    const lines = ["## Where to look", ""];
    if (artefacts.video) lines.push(`- the recording: \`${this.short(artefacts.video)}\``);
    if (artefacts.frames) lines.push(`- the frames: \`${this.short(artefacts.frames)}\``);
    if (artefacts.trace) {
      // Playwright's own trace viewer: the DOM at every action, the network with bodies, the sources.
      // Written when the RUN ends, so this names where it lands rather than promising it is there yet.
      lines.push(`- everything, in the trace viewer:`);
      lines.push(`  \`npx playwright show-trace ${artefacts.trace}\``);
    }
    if (artefacts.har) lines.push(`- the network as a HAR: \`${this.short(artefacts.har)}\``);
    lines.push("");
    return lines;
  }

  private failure(): { index: number; step: number; label: string; error: string; screenshot?: string } | undefined {
    const index = this.input.steps.findIndex(step => step.error);
    if (index < 0) return undefined;
    const step = this.input.steps[index];
    return { index, step: index + 1, label: step.step, error: step.error!, screenshot: step.screenshot };
  }

  /**
   * How the run reads at the top of the file.
   *
   * A run can pass every step and still have a request that failed: a job whose failure arrives by
   * polling is 200 the whole way, so every `wait` on it passes and the title says `ok`. That title is
   * the only line some readers get to, and reading `ok` over a network table with a traceback two
   * screens further down is the whole of #145. It says so instead — without touching whether the
   * action passed, which is what its steps asserted and not what this file is for.
   */
  private headline(): string {
    const { ok, steps } = this.input;
    if (!ok) return `failed at step ${this.failure()?.step ?? "?"} of ${steps.length}`;
    const quiet = this.failed().filter(request => !request.failure && (request.status ?? 0) < 400);
    return quiet.length ? `ok, but ${quiet.length} request${quiet.length === 1 ? "" : "s"} failed in the body` : "ok";
  }

  private failed(): RequestRecord[] {
    return this.input.recording.requests.filter(request => this.isFailure(request));
  }

  private slow(): RequestRecord[] {
    return this.input.recording.requests.filter(request => (request.ms ?? 0) > 1000);
  }

  /**
   * The status cell: what came back, and — when what came back was a 200 that was not one — what said so.
   *
   * The number alone is why this file used to lie. `200 · data.error` is the honest form: the transport
   * did answer 200, and the thing that made it a failure is named rather than left to whoever thinks to
   * open `debug.json`.
   */
  private status(request: RequestRecord): string {
    if (request.failure) return `**${request.failure}**`;
    const marker = this.bodies().failed.get(request);
    return marker ? `**${request.status ?? "—"} · ${marker}**` : String(request.status ?? "—");
  }

  /** Something the app did, or something that went wrong — as opposed to the page loading itself. */
  private isTraffic(request: RequestRecord): boolean {
    if (this.isFailure(request) || (request.ms ?? 0) > 1000) return true;
    // What came back decides, not how it was asked for: an app that fetches its icons through `fetch`
    // gets them typed as `xhr`, and forty SVGs then sit in the table as if they were the product
    // talking to its API.
    if (/^(image|font|audio|video)\/|css|javascript/.test(request.contentType ?? "")) return false;
    return Story.TRAFFIC.includes(request.resourceType);
  }

  /**
   * Whether a request failed — on the wire, or in what it said.
   *
   * This used to be the transport alone, and that one line was the whole of #145: an app answering 200
   * with `{"status":"failed"}` and a traceback read as completely healthy, in the artefact that exists
   * so nobody has to re-run anything with more logging. `witness` already HAD the body — it captured
   * it, wrote it to `debug.json` and did not look at it — so the fix is a predicate, not a capture.
   */
  private isFailure(request: RequestRecord): boolean {
    return !!request.failure || (request.status ?? 0) >= 400 || this.bodies().failed.has(request);
  }

  /**
   * Every recorded body read once against the markers the description declared.
   *
   * Applied to all of the traffic rather than only to whatever went to the client that declared it.
   * What a failure LOOKS like is a fact about a product's wire format, and the browser reaches the same
   * backend the harness's own client does — usually through the app's own origin, so scoping by the
   * client's base URL would miss precisely the requests this exists to catch. A marker specific enough
   * to be worth declaring does not fire on a third party's 200 by accident.
   *
   * Nothing is parsed and nothing is held when no marker was declared, which is every run that has not
   * asked for this. What is kept afterwards is a short string per failing request, not a parsed body.
   */
  private bodies(): { failed: Map<RequestRecord, string>; unreadable: number } {
    if (this.marked) return this.marked;
    const failed = new Map<RequestRecord, string>();
    let unreadable = 0;
    const rules = this.input.failureWhen ?? [];
    for (const request of rules.length ? this.input.recording.requests : []) {
      const body = request.responseBody?.trimStart();
      // Only what could be a JSON document at all. An HTML error page cannot carry a declared path, and
      // a bundle is a lot of parsing to arrive at the same answer.
      if (!body || (body[0] !== "{" && body[0] !== "[")) continue;
      const parsed = body.length > Story.MOST_BODY ? undefined : Story.parse(body);
      if (parsed === undefined) {
        unreadable += 1;
        continue;
      }
      const hit = rules.find(rule => Story.matches(parsed, rule));
      if (hit) failed.set(request, Story.marker(hit));
    }
    this.marked = { failed, unreadable };
    return this.marked;
  }

  /**
   * A body as data, or nothing at all.
   *
   * A body is not always JSON and a recorded one is routinely a valid one with its tail cut off. A
   * debug story that throws is worse than one that is too quiet, so this answers "could not read it"
   * and lets the caller say so.
   */
  private static parse(this: void, body: string): unknown {
    try {
      return JSON.parse(body);
    } catch {
      return undefined;
    }
  }

  /** Whether one declared marker fires against a parsed body. */
  private static matches(this: void, body: unknown, rule: FailureWhen): boolean {
    // The same dotted-path reader a template is filled through, so `data.error` means here what it
    // means everywhere else in a description — including through a field holding JSON as a string.
    const value = reach(body as Record<string, unknown>, rule.path);
    if (rule.equals !== undefined) return value === rule.equals;
    // An empty array, an empty string and a null are all an API saying nothing went wrong — `errors: []`
    // is the successful GraphQL response, not a failure with no detail.
    return !(value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length));
  }

  /** What to call a marker in the table — short enough for a cell, specific enough to look up. */
  private static marker(this: void, rule: FailureWhen): string {
    return rule.equals === undefined ? rule.path : `${rule.path}=${JSON.stringify(rule.equals)}`;
  }

  private static isNoisy(this: void, message: ConsoleRecord): boolean {
    return message.type === "error" || message.type === "warning";
  }

  private detail(request: RequestRecord): string[] {
    const marker = this.bodies().failed.get(request);
    const lines = [
      `**${request.method} ${Story.shorten(request.url)}** → ${request.failure ?? request.status}${marker ? ` · ${marker}` : ""} ` +
        `(${Story.duration(request.ms ?? 0)}) during \`${request.step}\``,
      "",
    ];
    if (request.requestBody) lines.push("Sent:", "```", Story.shorten(request.requestBody, 1200), "```", "");
    if (request.responseBody) lines.push("Came back:", "```", Story.shorten(request.responseBody, 1200), "```", "");
    // The one thing worse than a failure with no body is a failure with no body and no explanation.
    else if (request.bodyUnavailable) lines.push(`Came back with no readable body: _${request.bodyUnavailable}_`, "");
    return lines;
  }

  private static errorDetail(this: void, error: PageErrorRecord): string[] {
    return [`**${error.message}** during \`${error.step}\``, "", "```", Story.shorten(error.stack ?? "", 1200), "```", ""];
  }

  private static duration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  private static shorten(value: string, max = 90): string {
    return value.length <= max ? value : `${value.slice(0, max)}…`;
  }
}

export type StoryStep = {
  step: string;
  detail?: string;
  ms: number;
  error?: string;
  /** It passed, and something about HOW it passed is worth saying — an assertion matched off-screen. */
  warning?: string;
  screenshot?: string;
  /** For a `run` step: the directory the composed action filed its own evidence in. */
  ran?: string;
};

/** The files a human should open, which this deliberately does not try to replace. */
export type Artefacts = { video?: string; frames?: string; trace?: string; har?: string };

export type StoryInput = {
  name: string;
  /** The evidence directory, so every path in the story is said relative to it. */
  root?: string;
  ok: boolean;
  ms: number;
  steps: StoryStep[];
  recording: Recording;
  /** What it got away with: true but worth saying, so a green run is not silent about it. */
  warnings?: string[];
  /**
   * What a failure looks like in a response body, as the description's clients declare it.
   *
   * One per client, gathered by the system: an api's own `failureWhen`, or the one its wire format
   * declares for itself. Without any of these a request is judged on its transport status alone, which
   * is what made a 200 carrying a traceback read as healthy.
   */
  failureWhen?: FailureWhen[];
  /** What the system itself sent and ran, as opposed to what the browser did. */
  trace?: TraceEntry[];
  artefacts?: Artefacts;
};

export type StoryJson = {
  name: string;
  ok: boolean;
  ms: number;
  failure?: { index: number; step: number; label: string; error: string; screenshot?: string };
  steps: StoryStep[];
  network: {
    total: number;
    failed: number;
    slow: number;
    dropped: number;
    requests: RequestRecord[];
    /** The ones a declared `failureWhen` caught, by their position in `requests`, and what fired. */
    failedInBody: { index: number; marker: string }[];
  };
  console: ConsoleRecord[];
  pageErrors: PageErrorRecord[];
  harness: TraceEntry[];
  artefacts: Artefacts;
};
