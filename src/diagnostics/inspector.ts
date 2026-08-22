import type { ConsoleMessage, Page, Request, Response } from "@playwright/test";

import { Trace } from "./trace.ts";

/**
 * What a developer opens DevTools for, recorded while a run happens.
 *
 * The network tab, the console tab and the exceptions — with the one thing DevTools cannot give you
 * afterwards: which STEP each of them belongs to. "A 500 came back" is not a diagnosis; "the 500 came
 * back during `click Cancel order`, and the console error one tick later says the reducer got
 * undefined" is one, and reconstructing that by hand from three separate panes is the work this is
 * here to stop repeating.
 *
 * Response bodies are read for the ones worth reading — a failure, or something small and textual —
 * because fetching every image back out of the browser to store it is a lot of work to produce noise.
 */
export class Inspector {
  readonly requests: RequestRecord[] = [];
  readonly console: ConsoleRecord[] = [];
  readonly errors: PageErrorRecord[] = [];

  /** How many requests to keep. Saying so when it bites, rather than quietly holding the first N. */
  private readonly limit: number;
  private dropped = 0;
  private step: { index: number; label: string } = { index: 0, label: "before the first step" };
  private readonly started = Date.now();
  private readonly page: Page;
  private readonly pending = new Map<Request, RequestRecord>();
  private readonly listeners: [string, (arg: never) => void][] = [];
  private readonly bodies: Promise<void>[] = [];

  constructor(page: Page, opts: { limit?: number } = {}) {
    this.page = page;
    this.limit = opts.limit ?? 500;

    const onRequest = (request: Request): void => {
      if (this.requests.length >= this.limit) {
        this.dropped += 1;
        return;
      }
      const record: RequestRecord = {
        step: this.step.label,
        stepIndex: this.step.index,
        at: Date.now() - this.started,
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        requestBody: Inspector.clip(request.postData() ?? undefined),
      };
      this.requests.push(record);
      this.pending.set(request, record);
    };

    const onResponse = (response: Response): void => {
      const record = this.pending.get(response.request());
      if (!record) return;
      record.status = response.status();
      record.ms = Date.now() - this.started - record.at;
      record.contentType = response.headers()["content-type"];
      if (Inspector.worthReading(record)) this.bodies.push(Inspector.readBody(response, record));
    };

    // A request that never got a response at all: the failure a status code cannot describe.
    const onFailed = (request: Request): void => {
      const record = this.pending.get(request);
      if (!record) return;
      record.failure = request.failure()?.errorText ?? "request failed";
      record.ms = Date.now() - this.started - record.at;
    };

    const onConsole = (message: ConsoleMessage): void => {
      const where = message.location();
      this.console.push({
        step: this.step.label,
        stepIndex: this.step.index,
        at: Date.now() - this.started,
        type: message.type(),
        text: message.text(),
        source: where.url ? `${where.url}:${where.lineNumber}` : undefined,
      });
    };

    const onPageError = (error: Error): void => {
      this.errors.push({
        step: this.step.label,
        stepIndex: this.step.index,
        at: Date.now() - this.started,
        message: error.message,
        stack: error.stack,
      });
    };

    this.on("request", onRequest);
    this.on("response", onResponse);
    this.on("requestfailed", onFailed);
    this.on("console", onConsole);
    this.on("pageerror", onPageError);
  }

  /** Everything from here belongs to this step. */
  mark(label: string, index: number): void {
    this.step = { label, index };
  }

  /** Stop listening and hand back what was seen, once the bodies still in flight have landed. */
  async stop(): Promise<Recording> {
    // One `off` per event, typed at the call site: the union of every page event has no single
    // overload that accepts a string, and pretending otherwise only moves the error.
    for (const [event, listener] of this.listeners) {
      const page = this.page as unknown as { off: (event: string, listener: (arg: never) => void) => void };
      page.off(event, listener);
    }
    this.listeners.length = 0;
    await Promise.all(this.bodies);
    return {
      requests: this.requests,
      console: this.console,
      errors: this.errors,
      dropped: this.dropped,
    };
  }

  private on(event: string, listener: (arg: never) => void): void {
    const page = this.page as unknown as { on: (event: string, listener: (arg: never) => void) => void };
    page.on(event, listener);
    this.listeners.push([event, listener]);
  }

  /**
   * Whether to fetch a response's body back out of the browser.
   *
   * Anything that failed, and anything small and textual. Not images, fonts or a 4MB bundle: storing
   * those produces a file nobody reads and slows down the run that was supposed to be evidence.
   */
  private static worthReading(record: RequestRecord): boolean {
    if ((record.status ?? 0) >= 400) return true;
    if (record.resourceType === "image" || record.resourceType === "font" || record.resourceType === "media") return false;
    return /json|text|xml|html/.test(record.contentType ?? "");
  }

  private static async readBody(response: Response, record: RequestRecord): Promise<void> {
    try {
      const body = await response.text();
      record.responseBody = Inspector.clip(body);
    } catch {
      // A redirect, a body already consumed, a context that closed first: no body is a fact about the
      // response, not a failure of the run.
      record.responseBody = undefined;
    }
  }

  private static clip(value: string | undefined): string | undefined {
    return value === undefined ? undefined : (Trace.clip(value, 4000) as string);
  }
}

export type RequestRecord = {
  /** The step that was running when it started. */
  step: string;
  stepIndex: number;
  /** Milliseconds from the start of the run. */
  at: number;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  contentType?: string;
  ms?: number;
  requestBody?: string;
  responseBody?: string;
  /** Set when the request never got a response — `net::ERR_CONNECTION_REFUSED` and friends. */
  failure?: string;
};

export type ConsoleRecord = {
  step: string;
  stepIndex: number;
  at: number;
  type: string;
  text: string;
  source?: string;
};

export type PageErrorRecord = { step: string; stepIndex: number; at: number; message: string; stack?: string };

export type Recording = {
  requests: RequestRecord[];
  console: ConsoleRecord[];
  errors: PageErrorRecord[];
  /** Requests past the limit, counted rather than hidden. */
  dropped: number;
};
