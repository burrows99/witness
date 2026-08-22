/**
 * What the system did, in enough detail that nobody has to guess.
 *
 * Every request it makes, every statement it runs and every step it drives is recorded here with its
 * inputs, its outputs and how long it took. That matters most for whoever is NOT watching: an agent gets
 * back the network exchange rather than "it failed", and a person reading a CI log sees the request that
 * 400'd next to the body that caused it.
 *
 * Bodies are truncated, because a trace nobody can read is as useless as no trace.
 */
export class Trace {
  readonly entries: TraceEntry[] = [];

  private readonly limit: number;

  constructor(limit = 2000) {
    this.limit = limit;
  }

  add(entry: TraceEntry): TraceEntry {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    return entry;
  }

  /** A marker to slice from, so one action can report only its own traffic. */
  mark(): number {
    return this.entries.length;
  }

  since(mark: number): TraceEntry[] {
    return this.entries.slice(mark);
  }

  /** The most recent entry — `app.trace.last` after a call that surprised you. */
  get last(): TraceEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  static clip(value: unknown, max = 4000): unknown {
    if (typeof value !== "string") return value;
    return value.length > max ? `${value.slice(0, max)}… (${value.length} bytes)` : value;
  }
}

export type HttpTrace = {
  kind: "http";
  operation?: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  ms: number;
  error?: string;
  at: string;
};

export type SqlTrace = { kind: "sql"; query?: string; statement: string; rows: string; ms: number; at: string };

export type StepTrace = {
  kind: "step";
  action: string;
  step: string;
  detail?: string;
  ms: number;
  screenshot?: string;
  error?: string;
  at: string;
};

export type TraceEntry = HttpTrace | SqlTrace | StepTrace;
