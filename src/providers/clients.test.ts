import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { afterEach, test } from "node:test";

import { clientProviders, type ClientConfig, type OperationConfig } from "./clients.ts";
import { HttpApi } from "../http/client.ts";
import { Trace } from "../diagnostics/trace.ts";
import type { Stack } from "../environment/stack.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const answering = (payload: unknown): { seen: { url: string; init: RequestInit }[] } => {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof fetch;
  return { seen };
};

const context = (config: Partial<ClientConfig> = {}) => ({
  http: new HttpApi("http://api"),
  stack: { env: () => "" } as unknown as Stack,
  trace: new Trace(),
  config: { service: "api", operations: {}, ...config },
});

const rest = clientProviders.get("rest");
const graphql = clientProviders.get("graphql");

const call = <T>(op: OperationConfig, params = {}, body?: unknown, config?: Partial<ClientConfig>): Promise<T> =>
  rest.call<T>("op", op, params, body, context(config));

test("rest fills the path with the call's parameters", async () => {
  const { seen } = answering({});
  await call({ path: "/v1/orders/{orderId}" }, { orderId: 7 });
  equal(seen[0].url, "http://api/v1/orders/7");
  equal(rest.url({ path: "/v1/orders/{orderId}" }, { orderId: 7 }, context()), "http://api/v1/orders/7");
});

test("an operation's own body is templated, and the call's body wins over it", async () => {
  const { seen } = answering({});
  await call({ method: "POST", path: "/v1/orders", body: { customer: "{customerId}", source: "witness" } }, { customerId: "C1" }, { source: "override" });
  deepEqual(JSON.parse(String(seen[0].init.body)), { customer: "C1", source: "override" });
});

test("pick takes the part of the answer worth having", async () => {
  answering({ data: { orders: [{ id: "1" }, { id: "2" }] } });
  deepEqual(await call({ path: "/x", pick: "data.orders.1" }), { id: "2" });
});

test("where narrows an answer the other end refused to filter", async () => {
  // Third-party APIs routinely will not filter by the thing you care about; declaring it keeps the
  // workaround in the file that describes the integration rather than in an adapter class.
  answering([
    { id: "1", patient: { id: "P1" }, status: "open" },
    { id: "2", patient: { id: "P2" }, status: "open" },
  ]);
  deepEqual(await call({ path: "/x", where: { "patient.id": "{patientId}" } }, { patientId: "P2" }), [
    { id: "2", patient: { id: "P2" }, status: "open" },
  ]);
});

test("where understands startsWith, not and in — and matches strings case-insensitively", async () => {
  const items = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];
  answering(items);
  deepEqual(await call<{ name: string }[]>({ path: "/x", where: { name: { startsWith: "Be" } } }), [{ name: "Beta" }]);
  answering(items);
  deepEqual(await call<{ name: string }[]>({ path: "/x", where: { name: { not: "alpha" } } }), [{ name: "Beta" }, { name: "Gamma" }]);
  answering(items);
  deepEqual(await call<{ name: string }[]>({ path: "/x", where: { name: { in: ["ALPHA", "gamma"] } } }), [{ name: "Alpha" }, { name: "Gamma" }]);
});

test("map reshapes each item, from the answer or from the call", async () => {
  answering([{ id: "1", assignedToUserName: "Sam" }]);
  deepEqual(await call({ path: "/x", map: { who: "assignedToUserName", clinician: "{clinicianId}" } }, { clinicianId: "C9" }), [
    { who: "Sam", clinician: "C9" },
  ]);
});

test("then takes one more step, after the narrowing", async () => {
  answering({ data: [{ id: "1" }, { id: "2" }] });
  deepEqual(await call({ path: "/x", pick: "data", where: { id: "2" }, then: "0" }), { id: "2" });
});

test("graphql sends the document and its variables", async () => {
  const { seen } = answering({ data: { orders: { data: [{ id: "1" }] } } });
  const answer = await graphql.call(
    "orders.list",
    { query: "query($status: String) { orders(status: $status) { data { id } } }", variables: { status: "open" }, pick: "orders.data" },
    {},
    undefined,
    context(),
  );
  deepEqual(answer, [{ id: "1" }]);
  const sent = JSON.parse(String(seen[0].init.body));
  deepEqual(sent.variables, { status: "open" });
  equal(seen[0].init.method, "POST");
});

test("graphql errors are failures, not answers", async () => {
  // A GraphQL error arrives as a 200, so anything that only checks the status reports success.
  answering({ errors: [{ message: "no such patient" }, { message: "and another" }] });
  await rejects(
    () => graphql.call("patients.show", { query: "{ x }" }, {}, undefined, context()),
    /patients.show: no such patient; and another/,
  );
});

test("a graphql operation with no document says so", async () => {
  await rejects(() => graphql.call("nope", {}, {}, undefined, context()), /graphql operation "nope" declares no query/);
});

test("an operation naming an auth scheme the client does not define is a config error", async () => {
  await rejects(() => call({ path: "/x", auth: "member" }), /operation wants auth "member", which this client does not define/);
});

test("an operation's declared auth is attached to its request", async () => {
  const { seen } = answering({});
  await call({ path: "/x", auth: "service" }, {}, undefined, { auth: { service: { header: "x-key", from: "K" } } });
  equal((seen[0].init.headers as Record<string, string>)["x-key"], "K");
});

test("a whole-placeholder parameter keeps its type instead of becoming text", async () => {
  const { seen } = answering({});
  await call({ method: "POST", path: "/x", body: { ids: "{ids}", label: "for {name}" } }, { ids: ["a", "b"], name: "Sam" });
  deepEqual(JSON.parse(String(seen[0].init.body)), { ids: ["a", "b"], label: "for Sam" });
});

test("both providers are registered under the names a config uses", () => {
  deepEqual(clientProviders.names, ["rest", "graphql"]);
  ok(clientProviders.has("rest"));
});

test("graphql declares what its own failures look like, so no description has to", () => {
  // The test above it says a GraphQL error is a 200 and this client refuses it. The debug story is the
  // other reader of that same fact — it watches the BROWSER make these calls, where nothing throws —
  // and for as long as it judged a request by its status code the network table could never show a
  // GraphQL failure at all. The format defines this, so the provider says it rather than every project.
  deepEqual(clientProviders.get("graphql").failureWhen, { path: "errors", present: true });
  // REST defines nothing of the kind: a 200 means what the application decided it means, which is
  // exactly why `failureWhen` is a thing a description declares.
  equal(clientProviders.get("rest").failureWhen, undefined);
});
