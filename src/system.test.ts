import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { SystemConfig } from "./config/schema.ts";

/** The composite root pulls in the browser half, so this file runs where that is installed. */
const havePlaywright = await import("@playwright/test").then(
  () => true,
  () => false,
);
const { System } = havePlaywright ? await import("./system.ts") : ({} as typeof import("./system.ts"));
const when = { skip: havePlaywright ? false : "needs @playwright/test" };

const originalCwd = process.cwd();
afterEach(() => process.chdir(originalCwd));

/** A checkout to resolve against: the root is found by walking up from the working directory. */
const inCheckout = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "witness-system-"));
  writeFileSync(path.join(dir, "marker"), "");
  writeFileSync(path.join(dir, ".env"), "WEB_PORT=3100\n");
  process.chdir(dir);
  return dir;
};

const config = (extra: Partial<SystemConfig> = {}): SystemConfig => ({
  name: "acme",
  root: ["marker"],
  services: { web: { port: 3000, portVar: "WEB_PORT", container: "acme-web" }, api: { port: 8080, container: "acme-api" } },
  ...extra,
});

test("a system is assembled from the description, and knows where the stack is", when, () => {
  inCheckout();
  const system = new System(config());
  deepEqual(system.endpoints, { web: "http://localhost:3100", api: "http://localhost:8080" });
  deepEqual(system.containers, { web: "acme-web", api: "acme-api" });
});

test("an app the config declares is reachable by name, with a screen per route", when, () => {
  inCheckout();
  const system = new System(config({ apps: { customer: { service: "web", routes: { dashboard: "/", order: "/orders/{orderId}" } } } })) as never as Record<string, { dashboard: { url: () => string }; order: { url: (p: Record<string, unknown>) => string } }>;
  equal(system.customer.dashboard.url(), "http://localhost:3100/");
  equal(system.customer.order.url({ orderId: "1234" }), "http://localhost:3100/orders/1234");
});

test("a declared name may not shadow one the system already has", when, () => {
  // An app called `db` replaced the database, and the failure surfaced much later as
  // `this.db.sql is not a function` — which reads as a bug in here rather than a collision in the config.
  inCheckout();
  throws(() => new System(config({ apps: { db: { service: "web" } } })), /app "db" would shadow the system's own `db`/);
  throws(() => new System(config({ apps: { trace: { service: "web" } } })), /reserved: api, db, stack, apps, actions, trace, config, endpoints, containers/);
});

test("a client naming a service nobody declared fails while the config is being read", when, () => {
  inCheckout();
  throws(
    () => new System(config({ clients: { billing: { service: "nowhere", operations: {} } } })),
    /client "billing" names service "nowhere", which is not declared/,
  );
});

test("an undeclared client, cast member, identity or secret each say what is missing", when, () => {
  inCheckout();
  const system = new System(config({ cast: { REGULAR: { id: "1" } }, identities: { staff: { cookies: [] } } }));
  throws(() => system.client("billing"), /no client "billing" — declared: none/);
  throws(() => system.cast("NOBODY"), /no cast member "NOBODY" in the config/);
  throws(() => system.identity("nobody"), /no identity "nobody" in the config/);
  throws(() => system.secret("nothing"), /no secret "nothing" — declared:/);
  deepEqual(system.cast("REGULAR"), { id: "1" });
  deepEqual(system.identity("staff"), { cookies: [] });
});

test("services can be asked for by whose software they are", when, () => {
  inCheckout();
  const system = new System(config({ services: { web: { port: 3000, kind: "in-house" }, billing: { url: "https://sandbox.example", kind: "third-party" } } }));
  deepEqual(system.services(), ["web", "billing"]);
  deepEqual(system.services("in-house"), ["web"]);
  deepEqual(system.services("third-party"), ["billing"]);
});

test("a service is unlabelled means ours", when, () => {
  inCheckout();
  deepEqual(new System(config()).services("in-house"), ["web", "api"]);
});

test("expand fills a template with where things are", when, () => {
  inCheckout();
  const system = new System(config());
  equal(system.expand("- the app: {web}"), "- the app: http://localhost:3100");
  equal(system.expand("docker logs @api"), "docker logs acme-api");
  // Something that names neither is left as it is rather than becoming a hole.
  equal(system.expand("@nothing"), "@nothing");
});

test("code the config cannot describe is attached by name, and refuses to collide", when, () => {
  inCheckout();
  const system = new System(config()).use("payments", () => ({ pay: () => "paid" }));
  equal(system.payments.pay(), "paid");
  throws(() => system.use("api", () => ({})), /extension "api" would shadow/);
});

test("a stub nobody declared lists the ones that are", when, async () => {
  inCheckout();
  await new System(config()).stub("vendor").then(
    () => ok(false, "should have refused"),
    (err: Error) => match(err.message, /no stub "vendor" — declared: none/),
  );
});

test("the command line is built from the config, without an entry point to write", when, () => {
  inCheckout();
  const cli = new System(
    config({
      api: { service: "api", operations: { "orders.show": { path: "/v1/orders/{orderId}" } } },
      cli: { order: { summary: "orders", verbs: { show: { operation: "orders.show", args: ["orderId"] } } } },
      actions: { "customer.cancel": { summary: "cancel an order", steps: [] } },
      stubs: { vendor: { port: 4010, routes: [] } },
    }),
  ).cli();
  const usage = cli.usage();
  match(usage, /order\s+orders/);
  match(usage, /show\s+<orderId>/);
  match(usage, /action\s+run one of the declared actions/);
  match(usage, /stub\s+the local stand-ins/);
  match(usage, /api\s+any route on the API/);
});

test("a database credential is a source, not a string the config has to hold", () => {
  // It was a bare string only, which made this the one credential the description FORCED into the
  // file. "There is nowhere else to put it" is the wrong reason for a credential to be in a repo.
  const system = new System({
    name: "t",
    services: { postgres: { port: 5432, container: "c" } },
    database: { service: "postgres", user: "u", database: "d", credential: { env: "WITNESS_TEST_DB_CREDENTIAL_SOURCE" } },
  });
  // Nothing is set in the environment and nothing needs to be: what this asserts is that the config
  // can NAME a source instead of holding a value, which is the whole point of the change.
  ok(system.db, "the database is built without the password being written down");
});
