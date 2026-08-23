import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { SystemConfig } from "./config/schema.ts";
import { loadConfig, normalise } from "./config/index.ts";

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

test("a step that leaves the app is sent to an origin off the stack, not one typed into the step", when, () => {
  // What a `waitForUrl` naming a service resolves through. The port comes from the same place every
  // other port does, so a sign-in that hands the browser to an identity provider survives `portVar`
  // moving it — and a service with no port at all is a different mistake from a name nobody declared.
  inCheckout();
  const system = new System(config({ services: { web: { port: 3000, portVar: "WEB_PORT" }, worker: {} } }));
  equal(system.origin("web"), "http://localhost:3100");
  throws(() => system.origin("worker"), /service "worker" publishes no port, so there is no origin to land on/);
  throws(() => system.origin("keycloak"), /no service "keycloak" — declared: web, worker/);
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
  match(usage, /api\s+any operation this description declares, by name/);
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

test("a terminal action is recognised as one through the real System", when, () => {
  // The seam nothing stood on. `runActions` asks `system.actionConfig(name)` and branches on
  // `records`, and every test of that branch handed in its own stub — so `actionConfig` could be made
  // to answer `undefined` for every action alive and 424 tests still passed, while every
  // `records: "terminal"` action fell through to the browser path and filmed a blank screen beside the
  // shell it was really about. Green run, wrong tool, and only the pixels would say so.
  //
  // Through `loadConfig`, not `new System({…})`: an action lives INSIDE its service in the file and is
  // hoisted, qualified and given its service's recorder by `normalise`. A fixture handed straight to
  // the constructor is the shape a config is WRITTEN in, which no caller ever passes.
  const dir = inCheckout();
  const file = path.join(dir, "config.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "acme",
      root: ["marker"],
      services: {
        web: { port: 3000, container: "acme-web", actions: { openHome: { steps: [{ goto: { route: "home" } }] } } },
        shell: {
          port: 5432,
          container: "acme-db",
          records: "terminal",
          shell: "docker exec -it acme-db bash",
          actions: { readTheDatabase: { steps: [{ type: { on: "prompt", value: "psql -l" } }] } },
        },
      },
    }),
  );
  const system = new System(loadConfig(file));

  // Qualified by the service that owns it, and carrying that service's recorder — which is how a lane
  // finds out to film a shell rather than a screen.
  const terminal = system.actionConfig("shell.readTheDatabase");
  equal(terminal?.records, "terminal");
  equal(terminal?.shell, "docker exec -it acme-db bash");
  // And a service that names no recorder still gets the browser.
  equal(system.actionConfig("web.openHome")?.records, undefined);
  equal(system.actionConfig("nothing.declared"), undefined);
});

test("a service's own action reaches its own secret by bare name", when, () => {
  // The headline of the service-owned reorganisation, and the one line of it nothing stood on.
  // `normalise.test` checks `scoped("adminKey", "grafana")` — a SERVICE name — while every real caller
  // is the engine, which passes the ACTION name. `System.secret` cuts the service off the front of it,
  // and that cut had no test: delete it and every `{secret.…}` written inside a service's own action
  // stops resolving, with `no secret "adminKey" — declared: grafana.adminKey`, which reads as the
  // config being wrong rather than the tool.
  //
  // Through `normalise`, because that is the shape `System` receives: a service's secrets are given
  // scoped names on the way in, and a fixture handed the written shape would find nothing to scope.
  inCheckout();
  process.env.GRAFANA_CREDENTIAL_SOURCE = "grafana-value";
  process.env.BILLING_CREDENTIAL_SOURCE = "billing-value";
  const system = new System(
    normalise({
      name: "acme",
      root: ["marker"],
      services: {
        grafana: {
          port: 3000,
          container: "acme-grafana",
          secrets: { adminKey: { env: "GRAFANA_CREDENTIAL_SOURCE" } },
          actions: { signIn: { steps: [] } },
        },
        billing: { port: 8080, container: "acme-billing", secrets: { adminKey: { env: "BILLING_CREDENTIAL_SOURCE" } } },
      },
    }),
  );

  // The scope the engine actually passes is the qualified ACTION name.
  equal(system.secret("adminKey", "grafana.signIn"), "grafana-value");
  equal(system.secret("adminKey", "billing.charge"), "billing-value");
  // The service name alone — what a caller outside an action would use — still works.
  equal(system.secret("adminKey", "grafana"), "grafana-value");
  // And with no scope there is nothing to disambiguate two services that both declared one, so it
  // says so rather than picking.
  throws(() => system.secret("adminKey"), /no secret "adminKey" — declared: grafana\.adminKey, billing\.adminKey/);
});
