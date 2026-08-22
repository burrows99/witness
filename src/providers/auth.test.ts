import { deepEqual, equal, match, ok, rejects, throws } from "node:assert/strict";
import { afterEach, test } from "node:test";

import { authHeaders } from "./auth.ts";
import type { Stack } from "../environment/stack.ts";

const stack = { env: (service: string, key: string) => `${service}-${key}-value` } as unknown as Stack;
const context = (params: Record<string, unknown> = {}) => ({ stack, params });

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("apiKey puts the credential in a header, X-API-KEY unless told otherwise", async () => {
  deepEqual(await authHeaders({ from: "abc" }, context()), { "X-API-KEY": "abc" });
  deepEqual(await authHeaders({ header: "x-token", from: "abc" }, context()), { "x-token": "abc" });
});

test("apiKey can take its value out of a running container", async () => {
  deepEqual(await authHeaders({ provider: "apiKey", header: "x-key", fromContainerEnv: { service: "api", key: "ADMIN" } }, context()), {
    "x-key": "api-ADMIN-value",
  });
});

test("apiKey refuses to send an empty credential", async () => {
  // Sending nothing produces a 401 that looks like the app's fault; saying so here points at the config.
  await rejects(() => authHeaders({ provider: "apiKey", from: { env: "NOTHING_SET" } }, context()), /apiKey auth resolved to nothing/);
});

test("bearer is the same credential, said differently", async () => {
  deepEqual(await authHeaders({ provider: "bearer", from: "t" }, context()), { Authorization: "Bearer t" });
});

test("cookie auth takes the session from the call, not from the config", async () => {
  deepEqual(await authHeaders({ cookie: "sid" }, context({ sid: "abc" })), { Cookie: "sid=abc" });
  deepEqual(await authHeaders({ cookie: "session" }, context({ session: "xyz" })), { Cookie: "session=xyz" });
  // A named cookie still falls back to `sid`, which is what every caller passes.
  deepEqual(await authHeaders({ cookie: "session" }, context({ sid: "xyz" })), { Cookie: "session=xyz" });
});

test("cookie auth with no session says which value is missing", async () => {
  await rejects(() => authHeaders({ cookie: "sid" }, context()), /cookie auth "sid" needs the value passed with the call/);
});

test("a config that names no provider picks one from what it declares", async () => {
  // `cookie` present means session auth; anything else is a key in a header.
  ok("Cookie" in (await authHeaders({ cookie: "sid" }, context({ sid: "1" }))));
  ok("X-API-KEY" in (await authHeaders({ value: "k" }, context())));
});

test("login signs in once and carries what that returned", async () => {
  let calls = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls += 1;
    deepEqual(JSON.parse(String(init.body)), { username: "u", password: "p" });
    return new Response(JSON.stringify({ token: "T", practice: { id: "P" } }), { status: 200 });
  }) as unknown as typeof fetch;

  const config = {
    provider: "login",
    login: { url: "https://sandbox.example/auth/local", body: { username: "u", password: "p" } },
    derive: { "x-practice": "practice.id" },
  };
  deepEqual(await authHeaders(config, context()), { Authorization: "Bearer T", "x-practice": "P" });

  // These are real sessions on somebody else's system: one per login block per run.
  await authHeaders(config, context());
  equal(calls, 1);
});

test("a login that fails says what the other end said", async () => {
  globalThis.fetch = (async () => new Response("no such user", { status: 401 })) as typeof fetch;
  await rejects(
    () => authHeaders({ provider: "login", login: { url: "https://sandbox.example/nope" } }, context()),
    /login https:\/\/sandbox.example\/nope → 401: no such user/,
  );
});

test("login without a login block says so rather than throwing about undefined", async () => {
  await rejects(() => authHeaders({ provider: "login" }, context()), /login auth needs a `login` block/);
});

test("an unknown provider names the ones that exist", () => {
  // Thrown where the config is read rather than where the request is made: this is a typo, not a failure.
  throws(() => authHeaders({ provider: "mtls" }, context()), /no auth provider "mtls" — registered: apiKey, bearer, cookie, login/);
});

test("a login body can itself come from a secret", async () => {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    match(String(init.body), /api-PASSWORD-value/);
    return new Response(JSON.stringify({ token: "T" }), { status: 200 });
  }) as unknown as typeof fetch;
  await authHeaders(
    {
      provider: "login",
      login: { url: "https://sandbox.example/two", body: { password: { containerEnv: { service: "api", key: "PASSWORD" } } } },
    },
    context(),
  );
});
