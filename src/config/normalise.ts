import type { ActionConfig } from "../actions/engine.ts";
import type { ServiceConfig, SystemConfig } from "./schema.ts";

/**
 * What a service owns, hoisted to what the system reads.
 *
 * A description used to put everything at the top level and make each entry name its service back
 * again: `api.service`, `apps.web.service`, `database.service`, and every action carrying `"app":
 * "grafana"` plus a `grafana.` typed into its own name. The service was named four times and the
 * prefix was a convention nothing enforced — so `grafana.signIn` could sit next to `"app": "web"` and
 * the description would load, and lie.
 *
 * Now a service carries what belongs to it and the top level carries only what is SHARED. This turns
 * the one into the other, so nothing downstream knows there were ever two shapes: a service's action
 * gets its qualified name and its `app` filled in, its api becomes the default client, its secrets get
 * scoped names.
 *
 * A description written the old way still loads. It is the same model either way, and telling somebody
 * their config is now invalid because a tool got tidier is not a trade worth making.
 */
export function normalise(config: SystemConfig): SystemConfig {
  const services = config.services ?? {};
  const owned = Object.entries(services).filter(([, service]) => hasOwnDescription(service));
  if (!owned.length) return config;

  const actions: Record<string, ActionConfig> = { ...config.actions };
  const apps = { ...config.apps };
  const secrets = { ...config.secrets };
  const clients = { ...config.clients };
  let api = config.api;
  let database = config.database;

  for (const [name, service] of owned) {
    for (const [actionName, action] of Object.entries(service.actions ?? {})) {
      // `grafana.signIn`, and it belongs to `grafana` — both of which the author had to type, and
      // either of which they could get wrong.
      actions[qualify(name, actionName)] = { app: name, ...action };
    }
    if (service.app) apps[name] = { service: name, ...service.app };
    for (const [secretName, secret] of Object.entries(service.secrets ?? {})) {
      // Scoped, and resolved scope-first: two services with a `password` is the normal case, and a
      // description that cannot say so forces one of them to be called `otherPassword`.
      secrets[qualify(name, secretName)] = secret;
    }
    if (service.api) {
      // The first one is the default — what `witness api get` talks to and what an unqualified
      // operation means. Every other is a named client, which is what a second API already was.
      if (!api) api = { service: name, ...service.api };
      else clients[name] = { service: name, ...service.api };
    }
    if (service.database) {
      if (!database) database = { service: name, ...service.database };
      else throw new Error(`services "${database.service}" and "${name}" both declare a database, and this drives one`);
    }
  }

  return {
    ...config,
    // The nested halves are removed rather than left: what reads this should not be able to see two
    // sources for the same thing and pick the wrong one.
    services: Object.fromEntries(Object.entries(services).map(([name, service]) => [name, whereItRuns(service)])),
    actions,
    apps,
    secrets,
    clients,
    ...(api ? { api } : {}),
    ...(database ? { database } : {}),
  };
}

/** `grafana` + `signIn` → `grafana.signIn`, and an already-qualified name is left alone. */
export function qualify(service: string, name: string): string {
  return name.startsWith(`${service}.`) ? name : `${service}.${name}`;
}

/**
 * A name as the service that owns it would find it, then as anyone would.
 *
 * `{secret.adminPassword}` in one of grafana's actions means grafana's, and falls back to a shared one
 * — which is how a description says "the password for this service" and "our one CI token" without
 * inventing a naming convention for either.
 */
export function scoped(name: string, scope: string | undefined): string[] {
  return scope && !name.includes(".") ? [qualify(scope, name), name] : [name];
}

function hasOwnDescription(service: ServiceConfig): boolean {
  return Boolean(service.actions || service.app || service.secrets || service.api || service.database);
}

/** Just the half that says where it runs — what the stack needs, and nothing else. */
function whereItRuns(service: ServiceConfig): ServiceConfig {
  const { actions, app, secrets, api, database, ...rest } = service;
  return rest;
}
