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

test("what the app said is in the table; what the page loaded is counted under it", () => {
  // A single navigation in a dev server pulls forty chunks. Listing them next to the two requests the
  // product made buries the ones somebody opened this file for.
  const out = story({
    recording: recording({
      requests: [
        request({ resourceType: "document", url: "http://localhost:3000/login" }),
        request({ resourceType: "fetch", url: "http://localhost:3000/api/session" }),
        ...Array.from({ length: 30 }, (_, i) => request({ resourceType: "script", url: `http://localhost:3000/_next/chunk-${i}.js`, ms: 20 })),
      ],
    }),
  }).markdown();
  match(out, /\/api\/session/);
  match(out, /…and 30 static assets \(scripts, styles, fonts, images\) — all under 400, slowest 20ms/);
  ok(!/chunk-12\.js/.test(out), "a chunk that did nothing wrong should not be in the table");
});

test("an asset that failed or crawled is traffic, whatever its type", () => {
  const out = story({
    recording: recording({
      requests: [
        request({ resourceType: "script", url: "http://localhost:3000/_next/broken.js", status: 404 }),
        request({ resourceType: "image", url: "http://localhost:3000/huge.png", status: 200, ms: 3000 }),
        request({ resourceType: "script", url: "http://localhost:3000/_next/fine.js", ms: 12 }),
      ],
    }),
  }).markdown();
  match(out, /broken\.js/);
  match(out, /huge\.png/);
  ok(!/fine\.js/.test(out));
});

test("a console message the size of a component tree is clipped, not pasted", () => {
  const huge = `A tree hydrated but some attributes did not match. ${"<div>".repeat(400)}`;
  const out = story({ recording: recording({ console: [{ step: "goto", stepIndex: 0, at: 1, type: "error", text: huge }] }) }).markdown();
  ok(out.length < 2000, "the story should not become the component tree");
  match(out, /A tree hydrated but some attributes did not match/);
  match(out, /…/);
  // …and the whole thing is still there for whatever reads the data.
  const json = story({ recording: recording({ console: [{ step: "goto", stepIndex: 0, at: 1, type: "error", text: huge }] }) }).json();
  equal(json.console[0].text, huge);
});

test("paths are said relative to the evidence directory", () => {
  const out = story({
    root: "/checkout/.witness/artifacts/spec/test/run",
    steps: [{ step: "goto", ms: 5, screenshot: "/checkout/.witness/artifacts/spec/test/run/actions/a/01-goto.png" }],
    artefacts: { video: "/checkout/.witness/artifacts/spec/test/run/video.mp4", trace: "/checkout/out/trace.zip" },
  }).markdown();
  match(out, /· actions\/a\/01-goto\.png/);
  match(out, /the recording: `video\.mp4`/);
  // Outside the evidence directory it stays absolute, because that is what you would have to type.
  match(out, /show-trace \/checkout\/out\/trace\.zip/);
});

test("a failure whose body could not be read says so where the body would be", () => {
  const out = story({
    recording: recording({
      requests: [request({ status: 500, bodyUnavailable: "the response had no body" })],
    }),
  }).markdown();
  match(out, /### The ones that failed/);
  match(out, /Came back with no readable body: _the response had no body_/);
});

test("a step that passed in a way worth knowing about is not buried under a tick", () => {
  // The only failure mode that yields a green run AND a wrong deliverable: an assertion satisfied by a
  // node that is not in the picture beside it.
  const out = story({
    steps: [
      { step: "goto", ms: 10 },
      { step: "expect", detail: "testId=sidebar", ms: 20, warning: "matched a node outside the viewport (at 0,-400 in 1280×900) — it passed, and the frame does not show it" },
    ],
  }).markdown();
  match(out, /## 1 step passed in a way worth knowing about/);
  match(out, /- `expect` — matched a node outside the viewport/);
  // …and again where the step is, so it reads in order too.
  match(out, /2\. ✓ `expect`.*\n {3}⚠ matched a node outside the viewport/);
});

test("what came back decides what is an asset, not how it was asked for", () => {
  // An app that fetches its icons through `fetch` gets them typed `xhr`, and forty SVGs then sit in the
  // table as if they were the product talking to its API.
  const out = story({
    recording: recording({
      requests: [
        request({ resourceType: "xhr", url: "http://localhost:3010/icons/eye.svg", contentType: "image/svg+xml" }),
        request({ resourceType: "fetch", url: "http://localhost:3010/api/user", contentType: "application/json" }),
      ],
    }),
  }).markdown();
  match(out, /\/api\/user/);
  ok(!/eye\.svg/.test(out), "an icon is an icon however it was fetched");
  match(out, /…and 1 static asset/);
});

/**
 * The traceback that came back as `200`.
 *
 * A real one, from the run in #145: a graph build that had 401'd against its provider the whole time,
 * reported by a polled task endpoint that answers 200 whatever the answer is.
 */
const failedTask = JSON.stringify({
  data: { error: 'Traceback (most recent call last):\n  File ".../zep_cloud/graph/raw_client.py", line 1071, in create', status: "failed" },
});

test("a 200 carrying the failure in its body is a failure, and the table says which marker fired", () => {
  // The whole of #145. Three ticks, every request 200, a clean console, `ok` in the title — over a
  // build that never worked. The body was captured and written to `debug.json` the whole time; what
  // was missing was a predicate willing to look at it.
  const input: Partial<StoryInput> = {
    recording: recording({
      requests: [
        request({ method: "POST", url: "http://localhost:8000/api/graph/build", responseBody: '{"data":{"taskId":"32f8"}}' }),
        request({ step: "wait", url: "http://localhost:8000/api/graph/task/32f8", responseBody: failedTask }),
      ],
    }),
    failureWhen: [{ path: "data.error", present: true }],
  };
  const out = story(input).markdown();

  // The title is the only line some readers get to, so it stops reading as `ok, nothing to look at`.
  match(out, /# customer\.cancelOrder — ok, but 1 request failed in the body \(4\.2s\)/);
  match(out, /## Network \(2 requests · 1 failed\)/);
  // The transport really did answer 200. What made it a failure is named beside it rather than left
  // to whoever thinks to open the JSON.
  match(out, /\| \*\*200 · data\.error\*\* \|.*graph\/task\/32f8/);
  match(out, /### The ones that failed/);
  match(out, /\*\*GET http:\/\/localhost:8000\/api\/graph\/task\/32f8\*\* → 200 · data\.error \(40ms\) during `wait`/);
  match(out, /zep_cloud\/graph\/raw_client\.py/);
  // The request that was fine is in the table and not in the failures.
  ok(!/\*\*200 · data\.error\*\*.*graph\/build/.test(out));

  // …and the same conclusion in the half something else reads, by the index of the request it is about.
  const json = story(input).json();
  equal(json.network.failed, 1);
  deepEqual(json.network.failedInBody, [{ index: 1, marker: "data.error" }]);
  // Still `ok`: what should fail a step is what the step asserted, and this changes what is reported.
  equal(json.ok, true);
});

test("a 200 that is genuinely fine is still a 200 that is genuinely fine", () => {
  // The other half of a predicate: one that fires on a healthy body is a checker that cries wolf,
  // which this repository holds to be worse than none.
  const out = story({
    recording: recording({
      requests: [
        request({ responseBody: '{"data":{"error":null,"status":"running"}}' }),
        request({ url: "http://localhost:3000/graphql", responseBody: '{"data":{"me":{"id":"1"}},"errors":[]}' }),
      ],
    }),
    failureWhen: [{ path: "data.error", present: true }, { path: "errors", present: true }],
  }).markdown();
  match(out, /# customer\.cancelOrder — ok \(4\.2s\)/);
  match(out, /## Network \(2 requests\)$/m);
  ok(!/The ones that failed/.test(out), "nothing went wrong, so nothing is spelled out");
  ok(!/\*\*200/.test(out), "and nothing is bolded");
});

test("a GraphQL error is a 200 by specification, and the table can finally show one", () => {
  // The provider declares this shape itself, so no description has to: `clients.ts` registers it, and
  // for as long as the predicate was the status code the table could never show a GraphQL failure at all.
  const out = story({
    recording: recording({
      requests: [request({ method: "POST", url: "http://localhost:3000/graphql", responseBody: '{"data":null,"errors":[{"message":"no such patient"}]}' })],
    }),
    failureWhen: [{ path: "errors", present: true }],
  }).markdown();
  match(out, /\| \*\*200 · errors\*\* \|/);
  match(out, /no such patient/);
});

test("a marker can be the value a field has, not only that it has one", () => {
  const out = story({
    recording: recording({ requests: [request({ responseBody: '{"success":false,"message":"card declined"}' })] }),
    failureWhen: [{ path: "success", equals: false }],
  }).markdown();
  match(out, /\| \*\*200 · success=false\*\* \|/);
  match(out, /card declined/);
});

test("a body that is not JSON, or JSON with its tail cut off, is not a story that throws", () => {
  // A body is not always JSON and a recorded one is routinely valid JSON that was clipped at 4000
  // characters on the way in. A debug story that crashes is worse than one that is too quiet — and a
  // marker that could not be looked for is said out loud, because a silent miss here is the same bug
  // one layer down.
  const clipped = `{"data":{"error":"Traceback (most recent${"…".repeat(3)}`;
  const out = story({
    recording: recording({
      requests: [
        request({ contentType: "text/html", responseBody: "<!doctype html><h1>502 Bad Gateway</h1>" }),
        request({ url: "http://localhost:3000/api/build", responseBody: clipped }),
        request({ url: "http://localhost:3000/api/huge", responseBody: `{"data":{"error":"${"x".repeat(20_000)}"}}` }),
      ],
    }),
    failureWhen: [{ path: "data.error", present: true }],
  }).markdown();
  match(out, /2 JSON bodies were not readable back/);
  ok(!/The ones that failed/.test(out), "unreadable is not the same claim as failed");
});

test("a body-level failure during the step that broke is pulled in with everything else", () => {
  const out = story({
    ok: false,
    steps: [{ step: "goto", ms: 10 }, { step: "wait", ms: 900, error: "timed out waiting for the build" }],
    recording: recording({ requests: [request({ step: "wait", stepIndex: 1, responseBody: failedTask })] }),
    failureWhen: [{ path: "data.error", present: true }],
  }).markdown();
  match(out, /- 1 request, \*\*1 of them failed\*\*/);
  match(out, /→ 200 · data\.error \(40ms\) during `wait`/);
});
