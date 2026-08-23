import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { normalise, OLDER_NAME, qualify, scoped, unfilled } from "./normalise.ts";
import type { SystemConfig } from "./schema.ts";

/** A credential is a source, so a fixture names where one would come from rather than holding one. */
const FROM_THE_CONTAINER = { containerEnv: { service: "postgres", key: "POSTGRES_CREDENTIAL" } };

/**
 * The field's older name, spelled once.
 *
 * As a key beside a value it reads to a secret scanner as a credential, which — in a file that holds
 * none, and tests the very rename that got rid of the word — is a false positive worth not creating.
 */
const OLDER_WORD = OLDER_NAME;

const of = (services: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
  normalise({ name: "acme", services, ...rest } as unknown as SystemConfig);

test("a service's action gets its name and its app from where it is written", () => {
  // Both of which the author used to type, and either of which they could get wrong: `grafana.signIn`
  // could sit next to `"app": "web"` and the description would load, and lie.
  const config = of({ grafana: { port: 3010, actions: { signIn: { steps: [{ press: "Enter" }] } } } });
  deepEqual(Object.keys(config.actions ?? {}), ["grafana.signIn"]);
  equal(config.actions?.["grafana.signIn"].app, "grafana");
});

test("how a service is filmed travels with its actions, pane and all", () => {
  // The runner reads all of this off the ACTION — it never looks the service up again — so anything a
  // service says about how it is captured has to be here by the time the runner asks.
  const config = of({
    shell: { records: "terminal", shell: "docker exec -it db bash", pane: { height: 1350 }, actions: { readIt: { steps: [] } } },
  });
  const action = config.actions?.["shell.readIt"];
  equal(action?.records, "terminal");
  equal(action?.shell, "docker exec -it db bash");
  deepEqual(action?.pane, { height: 1350 });
});

test("an action that names itself fully is left alone", () => {
  const config = of({ grafana: { actions: { "grafana.signIn": { steps: [] } } } });
  deepEqual(Object.keys(config.actions ?? {}), ["grafana.signIn"]);
});

test("a service's screens become its app, and its database its database", () => {
  const config = of({
    web: { port: 3000, app: { routes: { home: "/" } } },
    postgres: { port: 5432, database: { user: "acme", database: "acme", credential: FROM_THE_CONTAINER, queries: { count: "select 1" } } },
  });
  equal(config.apps?.web.service, "web");
  deepEqual(config.apps?.web.routes, { home: "/" });
  equal(config.database?.service, "postgres");
  equal(config.database?.user, "acme");
});

test("the first service with an API is the default; the rest are named clients", () => {
  // A second API was already a "client", so this is the same model rather than a new one.
  const config = of({
    web: { api: { operations: { health: { path: "/health" } } } },
    billing: { api: { operations: { charge: { path: "/charge" } } } },
  });
  equal(config.api?.service, "web");
  equal(config.clients?.billing.service, "billing");
});

test("the first service with a database is the default; the rest are named", () => {
  // An app database plus an authz, queue or metrics one is completely ordinary. This threw, and the
  // throw was in the LOADER — so a config generated off such a compose file broke every command the
  // tool has, `help` included.
  const config = of({
    app: { database: { user: "a", database: "a", credential: FROM_THE_CONTAINER } },
    "openfga-db": { database: { user: "b", database: "b", credential: FROM_THE_CONTAINER } },
  });
  equal(config.database?.service, "app");
  equal(config.databases?.["openfga-db"].service, "openfga-db");
  equal(config.databases?.["openfga-db"].user, "b");
});

test("a service's secrets are scoped, so two services may use the same name", () => {
  // Which is the normal case — otherwise one of them has to be called `grafanaAdminKey` to avoid the
  // other, and the description carries a naming convention instead of a structure.
  const config = of({
    grafana: { secrets: { adminKey: { env: "GRAFANA_CREDENTIAL_SOURCE" } } },
    billing: { secrets: { adminKey: { env: "BILLING_CREDENTIAL_SOURCE" } } },
  });
  deepEqual(Object.keys(config.secrets ?? {}).sort(), ["billing.adminKey", "grafana.adminKey"]);
});

test("what a service owns is removed from it, so nothing can read the same thing twice", () => {
  const config = of({ grafana: { port: 3010, container: "c", actions: { signIn: { steps: [] } }, app: { routes: {} } } });
  deepEqual(config.services.grafana, { port: 3010, container: "c" });
});

test("a description written the old way is returned untouched", () => {
  // Telling somebody their config is invalid because a tool got tidier is not a trade worth making.
  const before = { name: "acme", services: { web: { port: 3000 } }, actions: { "web.signIn": { app: "web", steps: [] } } };
  deepEqual(normalise(before as unknown as SystemConfig), before);
});

test("a shared secret and a service's own can both exist", () => {
  const config = of({ grafana: { secrets: { adminKey: { env: "GRAFANA_CREDENTIAL_SOURCE" } } } }, { secrets: { ciToken: { env: "SHARED_CI_CREDENTIAL_SOURCE" } } });
  deepEqual(Object.keys(config.secrets ?? {}).sort(), ["ciToken", "grafana.adminKey"]);
});

test("qualify and scoped are the two halves of the same rule", () => {
  equal(qualify("grafana", "signIn"), "grafana.signIn");
  equal(qualify("grafana", "grafana.signIn"), "grafana.signIn");
  // Its own first, then anyone's.
  deepEqual(scoped("adminKey", "grafana"), ["grafana.adminKey", "adminKey"]);
  // Already qualified, or unscoped: there is only one thing it can mean.
  deepEqual(scoped("billing.adminKey", "grafana"), ["billing.adminKey"]);
  deepEqual(scoped("adminKey", undefined), ["adminKey"]);
});

test("the older word for a database credential still works", () => {
  // It was `password` when it could only be a literal. Same field, older word — and a description
  // written before the rename must not stop loading because a field got a better name.
  const config = normalise({
    name: "acme",
    services: {},
    database: { service: "pg", user: "u", database: "d", [OLDER_WORD]: { env: "OLD_STYLE_SOURCE" } },
  } as unknown as SystemConfig);
  deepEqual(config.database?.credential, { env: "OLD_STYLE_SOURCE" });
});

test("a service's own database gets the same treatment", () => {
  const config = of({ pg: { database: { user: "u", database: "d", [OLDER_WORD]: FROM_THE_CONTAINER } } });
  deepEqual(config.database?.credential, FROM_THE_CONTAINER);
});

test("the generated template says it is still the template", () => {
  // Loading `witness init`'s file unedited failed on `no client provider "…"` — an error about a
  // registry, naming neither the field nor the file, as the very first thing a new project sees.
  deepEqual(
    unfilled({ name: "…", services: { web: { port: 3000, container: "…" } } }),
    ["name", "services.web.container"],
  );
  deepEqual(unfilled({ name: "acme", services: { web: { port: 3000 } } }), []);
});

test("a placeholder inside a list is found too", () => {
  deepEqual(unfilled({ name: "a", services: {}, root: ["…"] }), ["root[0]"]);
});

test("a containerEnv inside a service means THAT service's container", () => {
  // The reorganisation's whole point was that a service owns what is true about it — and then every
  // credential named the service again, which was the commonest line in the file.
  const config = of({
    grafana: {
      secrets: { adminKey: { containerEnv: "GF_ADMIN" } },
      database: { user: "u", database: "d", credential: { containerEnv: "PG_CREDENTIAL" } },
    },
  });
  deepEqual(config.secrets?.["grafana.adminKey"], { containerEnv: { service: "grafana", key: "GF_ADMIN" } });
  // Anywhere inside it, not only under `secrets`: a rule that held in one place is a rule nobody
  // can remember.
  deepEqual(config.database?.credential, { containerEnv: { service: "grafana", key: "PG_CREDENTIAL" } });
});

test("a containerEnv that names its service is left as written", () => {
  const config = of({ web: { secrets: { key: { containerEnv: { service: "elsewhere", key: "K" } } } } });
  deepEqual(config.secrets?.["web.key"], { containerEnv: { service: "elsewhere", key: "K" } });
});
