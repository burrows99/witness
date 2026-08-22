import type { ConsoleRecord, PageErrorRecord, Recording, RequestRecord } from "./inspector.ts";
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
  private readonly input: StoryInput;

  constructor(input: StoryInput) {
    this.input = input;
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
      },
      console: recording.console,
      pageErrors: recording.errors,
      harness: trace,
      artefacts,
    };
  }

  markdown(): string {
    const { name, ok, ms, steps, recording, trace = [], artefacts = {} } = this.input;
    const failure = this.failure();
    const lines: string[] = [];

    lines.push(
      `# ${name} — ${ok ? "ok" : `failed at step ${failure?.step ?? "?"} of ${steps.length}`} (${Story.duration(ms)})`,
      "",
    );

    lines.push("## What it was doing", "");
    steps.forEach((step, index) => {
      const mark = step.error ? "✗" : "✓";
      const detail = step.detail ? ` ${step.detail}` : "";
      lines.push(`${index + 1}. ${mark} \`${step.step}\`${detail} — ${Story.duration(step.ms)}${step.screenshot ? ` · ${step.screenshot}` : ""}`);
    });
    lines.push("");

    if (failure) {
      lines.push("## Where it broke", "");
      lines.push(`Step ${failure.step}, \`${failure.label}\`:`, "", "```", failure.error, "```", "");
      if (failure.screenshot) lines.push(`The screen at that moment: \`${failure.screenshot}\``, "");

      // The half of debugging that is otherwise three panes and a stopwatch: what the page was doing
      // while the step that failed was running.
      const during = recording.requests.filter(r => r.stepIndex === failure.index);
      const badDuring = during.filter(Story.isFailure);
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
      for (const request of badDuring.slice(0, 5)) lines.push(...Story.detail(request));
      for (const message of saidDuring.slice(0, 5)) lines.push(`> \`${message.type}\` ${message.text}${message.source ? ` — ${message.source}` : ""}`, "");
      for (const error of threwDuring.slice(0, 3)) lines.push(...Story.errorDetail(error));
    }

    lines.push(...this.network());
    lines.push(...this.console());
    lines.push(...this.pageErrors());
    lines.push(...Story.harness(trace));
    lines.push(...Story.where(artefacts));
    return lines.join("\n");
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
    lines.push("| at | step | method | status | ms | url |", "|---|---|---|---|---|---|");
    for (const request of recording.requests) {
      const status = request.failure ? `**${request.failure}**` : (request.status ?? "—");
      lines.push(
        `| ${Story.duration(request.at)} | ${request.step} | ${request.method} | ${status} |` +
          ` ${request.ms === undefined ? "—" : Story.duration(request.ms)} | ${Story.shorten(request.url)} |`,
      );
    }
    lines.push("");
    if (failed.length) {
      lines.push("### The ones that failed", "");
      for (const request of failed) lines.push(...Story.detail(request));
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
      lines.push(`- **${message.type}** during \`${message.step}\` — ${message.text}${message.source ? ` (${message.source})` : ""}`);
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

  private static where(artefacts: Artefacts): string[] {
    const lines = ["## Where to look", ""];
    if (artefacts.video) lines.push(`- the recording: \`${artefacts.video}\``);
    if (artefacts.frames) lines.push(`- the frames: \`${artefacts.frames}\``);
    if (artefacts.trace) {
      // Playwright's own trace viewer: the DOM at every action, the network with bodies, the sources.
      lines.push(`- everything, in the trace viewer: \`npx playwright show-trace ${artefacts.trace}\``);
    }
    if (artefacts.har) lines.push(`- the network as a HAR: \`${artefacts.har}\``);
    lines.push("");
    return lines;
  }

  private failure(): { index: number; step: number; label: string; error: string; screenshot?: string } | undefined {
    const index = this.input.steps.findIndex(step => step.error);
    if (index < 0) return undefined;
    const step = this.input.steps[index];
    return { index, step: index + 1, label: step.step, error: step.error!, screenshot: step.screenshot };
  }

  private failed(): RequestRecord[] {
    return this.input.recording.requests.filter(Story.isFailure);
  }

  private slow(): RequestRecord[] {
    return this.input.recording.requests.filter(request => (request.ms ?? 0) > 1000);
  }

  private static isFailure(request: RequestRecord): boolean {
    return !!request.failure || (request.status ?? 0) >= 400;
  }

  private static isNoisy(message: ConsoleRecord): boolean {
    return message.type === "error" || message.type === "warning";
  }

  private static detail(request: RequestRecord): string[] {
    const lines = [
      `**${request.method} ${Story.shorten(request.url)}** → ${request.failure ?? request.status} ` +
        `(${Story.duration(request.ms ?? 0)}) during \`${request.step}\``,
      "",
    ];
    if (request.requestBody) lines.push("Sent:", "```", Story.shorten(request.requestBody, 1200), "```", "");
    if (request.responseBody) lines.push("Came back:", "```", Story.shorten(request.responseBody, 1200), "```", "");
    return lines;
  }

  private static errorDetail(error: PageErrorRecord): string[] {
    return [`**${error.message}** during \`${error.step}\``, "", "```", Story.shorten(error.stack ?? "", 1200), "```", ""];
  }

  private static duration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  private static shorten(value: string, max = 90): string {
    return value.length <= max ? value : `${value.slice(0, max)}…`;
  }
}

export type StoryStep = { step: string; detail?: string; ms: number; error?: string; screenshot?: string };

/** The files a human should open, which this deliberately does not try to replace. */
export type Artefacts = { video?: string; frames?: string; trace?: string; har?: string };

export type StoryInput = {
  name: string;
  ok: boolean;
  ms: number;
  steps: StoryStep[];
  recording: Recording;
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
  network: { total: number; failed: number; slow: number; dropped: number; requests: RequestRecord[] };
  console: ConsoleRecord[];
  pageErrors: PageErrorRecord[];
  harness: TraceEntry[];
  artefacts: Artefacts;
};
