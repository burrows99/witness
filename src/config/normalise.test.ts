import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import { normalise, qualify, scoped, unfilled } from "./normalise.ts";
import type { SystemConfig } from "./schema.ts";

/** A password is a secret source, so a fixture can name where one would come from. */
const FROM_THE_CONTAINER = { containerEnv: { service: "postgres", key: "POSTGRES_PASSWORD" } };

const of = (services: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
  normalise({ name: "acme", services, ...rest } as unknown as SystemConfig);

test("a service's action gets its name and its app from where it is written", () => {
  // Both of which the author used to type, and either of which they could get wrong: `grafana.signIn`
  // could sit next to `"app": "web"` and the description would load, and lie.
  const config = of({ grafana: { port: 3010, actions: { signIn: { steps: [{ press: "Enter" }] } } } });
  deepEqual(Object.keys(config.actions ?? {}), ["grafana.signIn"]);
  equal(config.actions?.["grafana.signIn"].app, "grafana");
});

test("an action that names itself fully is left alone", () => {
  const config = of({ grafana: { actions: { "grafana.signIn": { steps: [] } } } });
  deepEqual(Object.keys(config.actions ?? {}), ["grafana.signIn"]);
});

test("a service's screens become its app, and its database its database", () => {
  const config = of({
    web: { port: 3000, app: { routes: { home: "/" } } },
    postgres: { port: 5432, database: { user: "acme", database: "acme", password: FROM_THE_CONTAINER, queries: { count: "select 1" } } },
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

test("two databases is a description of something this cannot drive", () => {
  throws(
    () => of({ a: { database: { user: "a", database: "a", password: FROM_THE_CONTAINER } }, b: { database: { user: "b", database: "b", password: FROM_THE_CONTAINER } } }),
    /both declare a database/,
  );
});

test("a service's secrets are scoped, so two services may each have a `password`", () => {
  const config = of({
    grafana: { secrets: { password: { env: "GRAFANA_PASSWORD" } } },
    billing: { secrets: { password: { env: "BILLING_PASSWORD" } } },
  });
  deepEqual(Object.keys(config.secrets ?? {}).sort(), ["billing.password", "grafana.password"]);
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
  const config = of({ grafana: { secrets: { password: { env: "G" } } } }, { secrets: { ciToken: { env: "CI" } } });
  deepEqual(Object.keys(config.secrets ?? {}).sort(), ["ciToken", "grafana.password"]);
});

test("qualify and scoped are the two halves of the same rule", () => {
  equal(qualify("grafana", "signIn"), "grafana.signIn");
  equal(qualify("grafana", "grafana.signIn"), "grafana.signIn");
  // Its own first, then anyone's.
  deepEqual(scoped("password", "grafana"), ["grafana.password", "password"]);
  // Already qualified, or unscoped: there is only one thing it can mean.
  deepEqual(scoped("billing.password", "grafana"), ["billing.password"]);
  deepEqual(scoped("password", undefined), ["password"]);
});

test("the generated template says it is still the template", () => {
  // Loading `witness init`'s file unedited failed on `no client provider "…"` — an error about a
  // registry, naming neither the field nor the file, as the very first thing a new project sees.
  deepEqual(
    unfilled({ name: "…", services: { web: { port: 3000, container: "…" } } } as unknown as SystemConfig),
    ["name", "services.web.container"],
  );
  deepEqual(unfilled({ name: "acme", services: { web: { port: 3000 } } } as unknown as SystemConfig), []);
});

test("a placeholder inside a list is found too", () => {
  deepEqual(unfilled({ name: "a", services: {}, root: ["…"] } as unknown as SystemConfig), ["root[0]"]);
});
