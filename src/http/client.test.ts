import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { afterEach, test } from "node:test";

import { HttpApi } from "./client.ts";
import { Trace } from "../diagnostics/trace.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Answer every request with this, and keep what was asked. */
const answering = (body: string, status = 200): { seen: { url: string; init: RequestInit }[] } => {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { seen };
};

test("a path is resolved against the base URL, and an absolute one is left alone", () => {
  const api = new HttpApi("http://localhost:3002");
  equal(api.url("/v1/health"), "http://localhost:3002/v1/health");
  equal(api.url("https://elsewhere.example/x"), "https://elsewhere.example/x");
});

test("a JSON answer comes back parsed", async () => {
  answering('{"status":"ok"}');
  deepEqual(await new HttpApi("http://api").get("/v1/health"), { status: "ok" });
});

test("an empty answer is undefined rather than a parse error", async () => {
  answering("");
  equal(await new HttpApi("http://api").delete("/v1/things/1"), undefined);
});

test("a body is sent as JSON, with the content type that says so", async () => {
  const { seen } = answering("{}");
  await new HttpApi("http://api").post("/v1/things", { name: "x" });
  equal(seen[0].init.method, "POST");
  equal(String(seen[0].init.body), '{"name":"x"}');
  equal((seen[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
});

test("a string body is sent as given — not everything is JSON", async () => {
  const { seen } = answering("{}");
  await new HttpApi("http://api").request("/x", { method: "POST", body: "raw=1" });
  equal(String(seen[0].init.body), "raw=1");
});

test("a failure says which request failed and what the server said", async () => {
  answering('{"message":"nope"}', 422);
  await rejects(() => new HttpApi("http://api").post("/v1/things"), /POST \/v1\/things → 422: \{"message":"nope"\}/);
});

test("what was sent is recorded, whether it worked or not", async () => {
  // A 400 with its body attached is the difference between fixing a request and guessing at it.
  answering('{"message":"nope"}', 400);
  const trace = new Trace();
  await new HttpApi("http://api", () => ({}), trace).post("/v1/things", { a: 1 }).catch(() => undefined);
  const entry = trace.last as { kind: string; status: number; requestBody: unknown; responseBody: unknown; error?: string };
  equal(entry.kind, "http");
  equal(entry.status, 400);
  deepEqual(entry.requestBody, { a: 1 });
  equal(entry.responseBody, '{"message":"nope"}');
  equal(entry.error, "400");
});

test("credentials are recorded as having been sent, never as their value", async () => {
  answering("{}");
  const trace = new Trace();
  await new HttpApi("http://api", () => ({ "x-api-key": "SECRET", Cookie: "sid=SECRET", Accept: "application/json" }), trace).get("/x");
  const headers = (trace.last as { requestHeaders: Record<string, string> }).requestHeaders;
  deepEqual(headers, { "x-api-key": "«sent»", Cookie: "«sent»", Accept: "application/json" });
  ok(!JSON.stringify(trace.entries).includes("SECRET"));
});

test("with() adds headers without disturbing the ones already there", async () => {
  const { seen } = answering("{}");
  await new HttpApi("http://api", () => ({ Accept: "application/json" })).with({ "x-tenant": "acme" }).get("/x");
  deepEqual(seen[0].init.headers, { Accept: "application/json", "x-tenant": "acme" });
});

test("with() can take a function, for a value that is not known yet", async () => {
  const { seen } = answering("{}");
  let session = "first";
  const api = new HttpApi("http://api").with(() => ({ Cookie: `sid=${session}` }));
  await api.get("/x");
  session = "second";
  await api.get("/x");
  equal((seen[1].init.headers as Record<string, string>).Cookie, "sid=second");
});

test("the operation a request came from is recorded with it", async () => {
  answering("{}");
  const trace = new Trace();
  await new HttpApi("http://api", () => ({}), trace).request("/x", { operation: "orders.show" });
  match(JSON.stringify(trace.last), /orders.show/);
});

test("a 200 that is not JSON comes back as what it said", async () => {
  // A readiness probe answering `pong` is a working endpoint, and `Unexpected token 'p'` is a worse
  // answer than `pong`.
  globalThis.fetch = (async () => new Response("pong", { status: 200, headers: { "content-type": "text/plain" } }));
  equal(await new HttpApi("http://api").get("/ping"), "pong");
});

test("something that CLAIMS to be JSON and is not says so, with the request and the body", async () => {
  globalThis.fetch = (async () =>
    new Response("<!doctype html><title>login</title>", { status: 200, headers: { "content-type": "application/json" } }));
  await rejects(
    () => new HttpApi("http://api").get("/v1/orders"),
    /GET \/v1\/orders → 200 said it was JSON and was not: .*body began <!doctype html>/,
  );
});

test("html from a redirect to a login page is returned, not thrown", async () => {
  // The everyday case behind "why is this failing": an unauthenticated request served a login page.
  globalThis.fetch = (async () =>
    new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html" } }));
  match(String(await new HttpApi("http://api").get("/v1/me")), /sign in/);
});
