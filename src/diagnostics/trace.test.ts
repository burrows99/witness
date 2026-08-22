import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";

import { Trace, type TraceEntry } from "./trace.ts";

const http = (url: string): TraceEntry => ({ kind: "http", method: "GET", url, ms: 1, at: "now" });

test("entries accumulate, and the last one is at hand", () => {
  const trace = new Trace();
  trace.add(http("/a"));
  trace.add(http("/b"));
  equal(trace.entries.length, 2);
  equal((trace.last as { url: string }).url, "/b");
});

test("a mark slices out one action's own traffic", () => {
  const trace = new Trace();
  trace.add(http("/before"));
  const mark = trace.mark();
  trace.add(http("/during"));
  trace.add(http("/also-during"));
  deepEqual(trace.since(mark).map(e => (e as { url: string }).url), ["/during", "/also-during"]);
});

test("an empty trace has no last entry", () => {
  equal(new Trace().last, undefined);
});

test("the oldest entries fall off rather than growing without bound", () => {
  const trace = new Trace(3);
  for (const url of ["/1", "/2", "/3", "/4"]) trace.add(http(url));
  deepEqual(trace.entries.map(e => (e as { url: string }).url), ["/2", "/3", "/4"]);
});

test("clip truncates long bodies and says how long they were", () => {
  const clipped = Trace.clip("x".repeat(50), 10) as string;
  match(clipped, /^x{10}… \(50 bytes\)$/);
  equal(Trace.clip("short", 10), "short");
  // Anything that is not a string is left alone: a parsed body is more useful whole.
  const body = { a: 1 };
  equal(Trace.clip(body), body);
  ok(Trace.clip(undefined) === undefined);
});
