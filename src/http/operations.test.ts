import { deepEqual, equal, match, ok, rejects, throws } from "node:assert/strict";
import { afterEach, test } from "node:test";

import { HttpApi } from "./client.ts";
import { Operations } from "./operations.ts";
import type { ClientConfig } from "../providers/clients.ts";
import type { Stack } from "../environment/stack.ts";
import { Trace } from "../diagnostics/trace.ts";

const originalFetch = globalThis.fetch;
const originalStderr = process.stderr.write.bind(process.stderr);
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stderr.write = originalStderr;
});

const stack = { env: () => "" } as unknown as Stack;

const operations = (config: Partial<ClientConfig> = {}, base = "http://api"): Operations =>
  new Operations(new HttpApi(base, () => ({}), new Trace()), stack, { service: "api", operations: {}, ...config }, new Trace());

/** Answer each request in turn, and keep what was asked. */
const answering = (...payloads: unknown[]): { seen: { url: string; method: string }[] } => {
  const seen: { url: string; method: string }[] = [];
  let call = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method ?? "GET") });
    const payload = payloads[Math.min(call, payloads.length - 1)];
    call += 1;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof fetch;
  return { seen };
};

test("the operations a client declares are its vocabulary", () => {
  const ops = operations({ operations: { "orders.show": { path: "/v1/orders/{id}" }, "orders.cancel": { path: "/x" } } });
  deepEqual(ops.names, ["orders.show", "orders.cancel"]);
  equal(ops.provider, "rest");
  deepEqual(ops.operation("orders.show"), { path: "/v1/orders/{id}" });
});

test("what a failure looks like in a body comes from the description, or from the wire format", () => {
  // The two halves of #145's fix meet here. A description says what ITS 200s mean; a format that
  // defines failure for itself needs nobody to say it. Both end up in the debug story, which is the
  // thing that used to read a 200 carrying a traceback as an unremarkable success.
  equal(operations().failureWhen, undefined);
  deepEqual(operations({ provider: "graphql" }).failureWhen, { path: "errors", present: true });
  // The product knows its own API better than its wire format does, so its own declaration wins.
  deepEqual(
    operations({ provider: "graphql", failureWhen: { path: "data.error", present: true } }).failureWhen,
    { path: "data.error", present: true },
  );
});

test("an operation nobody declared lists the ones that exist", () => {
  throws(() => operations({ operations: { a: {} } }).operation("nope"), /no such operation "nope" — declared: a/);
});

test("a name the config declares is called as the operation it is, not joined onto the base URL", async () => {
  // What the command line hands over is one argument that could be either, and the names are the half
  // the config exists to declare. Sent as a path, `orders.show` became `http://apiorders.show`.
  const { seen } = answering({ id: "4" });
  const ops = operations({ operations: { "orders.show": { path: "/v1/orders/{id}", method: "POST" } } });
  deepEqual(await ops.callOrRequest("orders.show", { id: 4 }), { id: "4" });
  // The declared method too: the verb typed at the prompt is how the command is reached, not a second
  // opinion about what goes on the wire.
  deepEqual(seen, [{ url: "http://api/v1/orders/4", method: "POST" }]);
});

test("…and a path is still a path, with the verb the caller asked for", async () => {
  const { seen } = answering({ ok: true });
  await operations({ operations: { a: {} } }).callOrRequest("/v1/health", {}, { method: "DELETE" });
  deepEqual(seen, [{ url: "http://api/v1/health", method: "DELETE" }]);
});

test("something that is neither says which it could have been", async () => {
  // `Failed to parse URL from http://localhost:5001health` describes a string the caller never typed.
  await rejects(
    () => operations({ operations: { listProjects: {}, getReport: {} } }).callOrRequest("health"),
    /no such operation "health" — declared: listProjects, getReport… \(paths start with \/\)/,
  );
});

test("url says where an operation would go, without going there", () => {
  equal(operations({ operations: { show: { path: "/v1/orders/{id}" } } }).url("show", { id: 4 }), "http://api/v1/orders/4");
});

test("a client that can delete refuses to run anywhere unexpected", () => {
  // The guard exists because these operations are irreversible on somebody else's system.
  throws(
    () => operations({ requireUrlMatch: "sandbox" }, "https://live.example"),
    /refusing to use https:\/\/live.example: it does not match sandbox/,
  );
  ok(operations({ requireUrlMatch: "sandbox" }, "https://sandbox.example"));
});

test("an operation that says how to reverse itself is remembered, and undone newest first", async () => {
  const { seen } = answering({ id: "one" }, { id: "two" }, {});
  const ops = operations({
    operations: {
      create: { method: "POST", path: "/v1/things", undo: { operation: "remove", param: "id" } },
      remove: { method: "DELETE", path: "/v1/things/{id}" },
    },
  });
  await ops.call("create");
  await ops.call("create");
  equal(await ops.undoAll(), 2);
  deepEqual(seen.slice(2).map(s => `${s.method} ${s.url}`), ["DELETE http://api/v1/things/two", "DELETE http://api/v1/things/one"]);

  // Nothing is left to undo the second time.
  equal(await ops.undoAll(), 0);
});

test("undo can find the id somewhere other than the top level", async () => {
  const { seen } = answering({ data: { appointment: { id: "deep" } } }, {});
  const ops = operations({
    operations: {
      book: { method: "POST", path: "/v1/bookings", undo: { operation: "cancel", param: "id", idPath: "data.appointment.id" } },
      cancel: { method: "DELETE", path: "/v1/bookings/{id}" },
    },
  });
  await ops.call("book");
  await ops.undoAll();
  match(seen[1].url, /\/v1\/bookings\/deep$/);
});

test("a cleanup that fails reports and keeps going", async () => {
  // A teardown that aborts halfway leaves more behind than one that keeps going — on a shared sandbox
  // that is somebody else's flaky run tomorrow.
  const said: string[] = [];
  process.stderr.write = ((text: string) => {
    said.push(text);
    return true;
  });

  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 3) return new Response("gone", { status: 404 });
    return new Response(JSON.stringify({ id: `id-${call}` }), { status: 200 });
  };

  const ops = operations({
    operations: { create: { method: "POST", path: "/v1/things", undo: { operation: "remove", param: "id" } }, remove: { method: "DELETE", path: "/v1/things/{id}" } },
  });
  await ops.call("create");
  await ops.call("create");
  equal(await ops.undoAll(), 1);
  match(said.join(""), /\[cleanup\] remove id-2/);
});

test("callForEach runs one operation for everything another returned", async () => {
  const { seen } = answering([{ id: "1" }, { id: "2" }], {});
  const ops = operations({
    operations: { list: { path: "/v1/things" }, remove: { method: "DELETE", path: "/v1/things/{id}" } },
  });
  equal(await ops.callForEach("list", {}, "remove", "id"), 2);
  deepEqual(seen.slice(1).map(s => s.url), ["http://api/v1/things/1", "http://api/v1/things/2"]);
});

test("the escape hatch is authenticated the way a declared operation would be", async () => {
  // An escape hatch that silently drops auth 403s and looks like the app's fault.
  const seen: Record<string, string>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(init.headers as Record<string, string>);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await operations({ auth: { service: { header: "x-key", from: "K" } } }).request("/v1/anything");
  equal(seen[0]["x-key"], "K");
});

test("a session-authenticated operation takes the session from the call", async () => {
  const seen: Record<string, string>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(init.headers as Record<string, string>);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const ops = operations({ auth: { member: { cookie: "sid" } }, operations: { me: { path: "/v1/me", auth: "member" } } });
  await ops.call("me", { sid: "abc" });
  equal(seen[0].Cookie, "sid=abc");
  await rejects(() => ops.call("me"), /cookie auth "sid" needs the value passed with the call/);
});
