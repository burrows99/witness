import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";

import { Story, type StoryInput } from "./story.ts";
import type { Recording, RequestRecord } from "./inspector.ts";

const request = (over: Partial<RequestRecord> = {}): RequestRecord => ({
  step: "click",
  stepIndex: 1,
  at: 100,
  method: "GET",
  url: "http://localhost:3000/api/orders",
  resourceType: "fetch",
  status: 200,
  ms: 40,
  ...over,
});

const recording = (over: Partial<Recording> = {}): Recording => ({
  requests: [],
  console: [],
  errors: [],
  dropped: 0,
  ...over,
});

const story = (over: Partial<StoryInput> = {}): Story =>
  new Story({
    name: "customer.cancelOrder",
    ok: true,
    ms: 4200,
    steps: [
      { step: "goto", detail: "/orders/1", ms: 400, screenshot: "actions/x/01-goto.png" },
      { step: "click", detail: "role=button name=Cancel", ms: 3800, screenshot: "actions/x/02-click.png" },
    ],
    recording: recording(),
    ...over,
  });

test("it opens with what was attempted, in order, with timings", () => {
  const out = story().markdown();
  match(out, /# customer\.cancelOrder — ok \(4\.2s\)/);
  match(out, /1\. ✓ `goto` \/orders\/1 — 400ms · actions\/x\/01-goto\.png/);
  match(out, /2\. ✓ `click` role=button name=Cancel — 3\.8s/);
});

test("a failure names the step, quotes the error, and points at the frame", () => {
  const out = story({
    ok: false,
    steps: [
      { step: "goto", ms: 400 },
      { step: "click", ms: 30_000, error: "locator resolved to 2 elements", screenshot: "actions/x/02-click.png" },
    ],
  }).markdown();
  match(out, /failed at step 2 of 2/);
  match(out, /## Where it broke/);
  match(out, /Step 2, `click`/);
  match(out, /locator resolved to 2 elements/);
  match(out, /The screen at that moment: `actions\/x\/02-click\.png`/);
});

test("what the page was doing during the step that failed — the part nobody assembles by hand", () => {
  const out = story({
    ok: false,
    steps: [{ step: "goto", ms: 10 }, { step: "click", ms: 900, error: "timed out" }],
    recording: recording({
      requests: [
        request({ stepIndex: 0, url: "http://localhost:3000/login" }),
        request({ stepIndex: 1, method: "POST", url: "http://localhost:3000/api/cancel", status: 500, responseBody: '{"message":"no such order"}', requestBody: '{"id":"1"}' }),
      ],
      console: [{ step: "click", stepIndex: 1, at: 120, type: "error", text: "Cannot read properties of undefined", source: "app.js:12" }],
      errors: [{ step: "click", stepIndex: 1, at: 130, message: "TypeError: undefined is not an object", stack: "at reducer (app.js:12)" }],
    }),
  }).markdown();

  match(out, /\*\*During that step:\*\*/);
  match(out, /- 1 request, \*\*1 of them failed\*\*/);
  match(out, /- the console said 1 thing worth reading/);
  match(out, /\*\*the page threw 1 uncaught error\*\*/);
  // The body that explains the 500, not just the number.
  match(out, /no such order/);
  match(out, /Cannot read properties of undefined/);
  match(out, /at reducer \(app\.js:12\)/);
});

test("the network is a table, and the failures are spelled out under it", () => {
  const out = story({
    recording: recording({
      requests: [
        request(),
        request({ method: "POST", url: "http://localhost:3000/api/pay", status: 402, responseBody: '{"error":"card declined"}' }),
        request({ url: "http://localhost:3000/slow", ms: 2400 }),
        request({ url: "http://localhost:3000/gone", status: undefined, failure: "net::ERR_CONNECTION_REFUSED" }),
      ],
    }),
  }).markdown();
  match(out, /## Network \(4 requests · 2 failed · 1 over a second\)/);
  match(out, /\| at \| step \| method \| status \| ms \| url \|/);
  match(out, /\*\*net::ERR_CONNECTION_REFUSED\*\*/);
  match(out, /### The ones that failed/);
  match(out, /card declined/);
});

test("requests past the limit are counted out loud, not quietly dropped", () => {
  match(story({ recording: recording({ requests: [request()], dropped: 37 }) }).markdown(), /37 more were not recorded/);
});

test("errors and warnings come before the chatter", () => {
  const out = story({
    recording: recording({
      console: [
        { step: "goto", stepIndex: 0, at: 1, type: "log", text: "hydrated" },
        { step: "click", stepIndex: 1, at: 2, type: "error", text: "boom", source: "app.js:1" },
      ],
    }),
  }).markdown();
  ok(out.indexOf("**error**") < out.indexOf("- log during"), "the error should be listed first");
});

test("what the harness itself did is separate from what the browser did", () => {
  const out = story({
    trace: [
      { kind: "http", method: "POST", url: "http://api/v1/orders", status: 201, ms: 90, at: "now", operation: "orders.create" },
      { kind: "sql", query: "order.status", statement: "select …", rows: "cancelled", ms: 4, at: "now" },
      { kind: "step", action: "a", step: "click", ms: 1, at: "now" },
    ],
  }).markdown();
  match(out, /## What the harness itself did/);
  match(out, /`POST http:\/\/api\/v1\/orders` → 201 \(90ms\) · orders\.create/);
  match(out, /`order\.status` \(4ms\) → cancelled/);
  // The steps are already the first section; repeating them here would be noise.
  ok(!/kind.*step/.test(out));
});

test("it points at the tools rather than replacing them", () => {
  const out = story({
    artefacts: { video: "a/video.mp4", frames: "a/frames", trace: "out/trace.zip", har: "out/network.har" },
  }).markdown();
  match(out, /the recording: `a\/video\.mp4`/);
  match(out, /npx playwright show-trace out\/trace\.zip/);
  match(out, /the network as a HAR: `out\/network\.har`/);
});

test("the same thing as data, for whatever reads it as data", () => {
  const json = story({
    ok: false,
    steps: [{ step: "click", ms: 5, error: "nope" }],
    recording: recording({ requests: [request({ status: 500 }), request()] }),
  }).json();
  equal(json.ok, false);
  deepEqual(json.failure, { index: 0, step: 1, label: "click", error: "nope", screenshot: undefined });
  equal(json.network.total, 2);
  equal(json.network.failed, 1);
  // Round-trips: whatever reads this gets the requests themselves, not a rendering of them.
  equal(json.network.requests[0].responseBody, undefined);
  equal(JSON.parse(JSON.stringify(json)).name, "customer.cancelOrder");
});
