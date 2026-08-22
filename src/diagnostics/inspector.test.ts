import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import { Inspector } from "./inspector.ts";

/** A page that hands out the events Playwright hands out, and remembers who is listening. */
const fakePage = () => {
  const listeners = new Map<string, ((arg: unknown) => void)[]>();
  const page = {
    on: (event: string, fn: (arg: unknown) => void) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
    off: (event: string, fn: (arg: unknown) => void) =>
      listeners.set(event, (listeners.get(event) ?? []).filter(l => l !== fn)),
  };
  const emit = (event: string, arg: unknown): void => (listeners.get(event) ?? []).forEach(fn => fn(arg));
  const count = (): number => [...listeners.values()].flat().length;
  return { page: page as never, emit, count };
};

const request = (over: Record<string, unknown> = {}) => ({
  method: () => "GET",
  url: () => "http://localhost:3000/api/orders",
  resourceType: () => "fetch",
  postData: () => null,
  failure: () => null,
  ...over,
});

const response = (req: unknown, over: Record<string, unknown> = {}) => ({
  request: () => req,
  status: () => 200,
  headers: () => ({ "content-type": "application/json" }),
  text: async () => '{"ok":true}',
  ...over,
});

test("a request and its response become one record", async () => {
  const { page, emit } = fakePage();
  const inspector = new Inspector(page);
  const req = request({ method: () => "POST", postData: () => '{"id":"1"}' });
  emit("request", req);
  emit("response", response(req, { status: () => 201 }));
  const seen = await inspector.stop();

  equal(seen.requests.length, 1);
  equal(seen.requests[0].method, "POST");
  equal(seen.requests[0].status, 201);
  equal(seen.requests[0].requestBody, '{"id":"1"}');
  equal(seen.requests[0].responseBody, '{"ok":true}');
});

test("every event carries the step that was running — the correlation nothing else has", () => {
  const { page, emit } = fakePage();
  const inspector = new Inspector(page);
  emit("request", request());
  inspector.mark("click", 3);
  emit("request", request({ url: () => "http://localhost:3000/api/cancel" }));
  emit("console", { type: () => "error", text: () => "boom", location: () => ({ url: "app.js", lineNumber: 12 }) });
  emit("pageerror", Object.assign(new Error("undefined is not an object"), { stack: "at reducer" }));

  deepEqual(inspector.requests.map(r => r.step), ["before the first step", "click"]);
  equal(inspector.console[0].step, "click");
  equal(inspector.console[0].source, "app.js:12");
  equal(inspector.errors[0].step, "click");
  equal(inspector.errors[0].message, "undefined is not an object");
});

test("a request that never got a response says what happened to it", async () => {
  const { page, emit } = fakePage();
  const inspector = new Inspector(page);
  const req = request({ failure: () => ({ errorText: "net::ERR_CONNECTION_REFUSED" }) });
  emit("request", req);
  emit("requestfailed", req);
  const seen = await inspector.stop();
  equal(seen.requests[0].failure, "net::ERR_CONNECTION_REFUSED");
  equal(seen.requests[0].status, undefined);
});

test("bodies are read for what is worth reading, and not for the rest", async () => {
  const { page, emit } = fakePage();
  const inspector = new Inspector(page);

  const image = request({ resourceType: () => "image" });
  emit("request", image);
  emit("response", response(image, { headers: () => ({ "content-type": "image/png" }), text: async () => "PNGDATA" }));

  const failed = request({ url: () => "http://localhost:3000/api/pay" });
  emit("request", failed);
  emit("response", response(failed, { status: () => 402, headers: () => ({ "content-type": "image/png" }), text: async () => "card declined" }));

  const seen = await inspector.stop();
  equal(seen.requests[0].responseBody, undefined, "an image body is noise");
  equal(seen.requests[1].responseBody, "card declined", "a failure's body is the diagnosis");
});

test("a body that cannot be read is a fact about the response, not a failure of the run", async () => {
  const { page, emit } = fakePage();
  const inspector = new Inspector(page);
  const req = request();
  emit("request", req);
  emit("response", response(req, {
    text: async () => {
      throw new Error("no body for redirect");
    },
  }));
  const seen = await inspector.stop();
  equal(seen.requests[0].responseBody, undefined);
  equal(seen.requests[0].status, 200);
});

test("past the limit it counts rather than keeps, and says how many", async () => {
  const { page, emit } = fakePage();
  const inspector = new Inspector(page, { limit: 2 });
  for (let i = 0; i < 5; i += 1) emit("request", request());
  const seen = await inspector.stop();
  equal(seen.requests.length, 2);
  equal(seen.dropped, 3);
});

test("stopping detaches every listener — a page outlives the action that watched it", async () => {
  const { page, emit, count } = fakePage();
  const inspector = new Inspector(page);
  ok(count() > 0);
  await inspector.stop();
  equal(count(), 0);
  emit("request", request());
  equal(inspector.requests.length, 0);
});

test("a failure with no readable body says why, rather than saying nothing", async () => {
  // "→ 500" and nothing else is a dead end, and "why is there nothing here" is the next question
  // every single time.
  const { page, emit } = fakePage();
  const inspector = new Inspector(page);

  const empty = request({ url: () => "http://localhost:3000/api/workspaces" });
  emit("request", empty);
  emit("response", response(empty, { status: () => 500, text: async () => "" }));

  const gone = request({ url: () => "http://localhost:3000/api/other" });
  emit("request", gone);
  emit("response", response(gone, {
    status: () => 500,
    text: async () => {
      throw new Error("Response body is unavailable for redirect responses");
    },
  }));

  const seen = await inspector.stop();
  equal(seen.requests[0].bodyUnavailable, "the response had no body");
  equal(seen.requests[1].bodyUnavailable, "Response body is unavailable for redirect responses");
});

test("a stylesheet is not a response body worth reading, however much text it contains", async () => {
  // `text/css` contains "text", which is how 109KB of Bootstrap landed in the middle of a debug story.
  const { page, emit } = fakePage();
  const inspector = new Inspector(page);

  for (const [type, body] of [
    ["text/css", "html{font-family:sans-serif}"],
    ["text/javascript", "export const a = 1;"],
    ["application/json", '{"ok":true}'],
    ["text/html", "<h1>hello</h1>"],
    ["text/plain", "pong"],
  ] as const) {
    const req = request({ url: () => `http://localhost:3000/${type}` });
    emit("request", req);
    emit("response", response(req, { headers: () => ({ "content-type": type }), text: async () => body }));
  }

  const seen = await inspector.stop();
  deepEqual(
    seen.requests.map(r => r.responseBody),
    [undefined, undefined, '{"ok":true}', "<h1>hello</h1>", "pong"],
  );
});

test("a stylesheet that 404s is still worth reading — a failure is a failure", async () => {
  const { page, emit } = fakePage();
  const inspector = new Inspector(page);
  const req = request({ url: () => "http://localhost:3000/missing.css" });
  emit("request", req);
  emit("response", response(req, { status: () => 404, headers: () => ({ "content-type": "text/css" }), text: async () => "not found" }));
  equal((await inspector.stop()).requests[0].responseBody, "not found");
});
