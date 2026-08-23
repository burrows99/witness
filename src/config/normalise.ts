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
/**
 * The template, still full of the placeholders it was generated with.
 *
 * `witness init` writes a config documenting every field, with `"…"` where a value goes. Loading it
 * unedited failed on `no client provider "…"` — an error about a registry, naming neither the field
 * nor the file, as the very first thing a new project sees. The first command in a new directory
 * should say what to do.
 */
export function unfilled(config: SystemConfig): string[] {
  const found: string[] = [];
  const walk = (value: unknown, at: string): void => {
    if (value === PLACEHOLDER) found.push(at || "(the whole file)");
    else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${at}[${i}]`));
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) walk(inner, at ? `${at}.${key}` : key);
    }
  };
  walk(config, "");
  return found;
}

/** What the generated template writes where a value goes. */
const PLACEHOLDER = "…";

export function normalise(config: SystemConfig): SystemConfig {
  const services = config.services ?? {};
  // Same field, older word — see `DatabaseConfig.credential`. Reached through a named constant so the
  // word appears once, in the one place that explains it, rather than as a key beside a value.
  const renamed = <T extends Record<string, unknown> | undefined>(database: T): T => {
    const older = database?.[OLDER_NAME];
    return database && older !== undefined && database.credential === undefined ? ({ ...database, credential: older }) : database;
  };
  if (config.database) config = { ...config, database: renamed(config.database) };
  for (const service of Object.values(services)) {
    if (service.database) service.database = renamed(service.database);
  }
  const owned = Object.entries(services).filter(([, service]) => hasOwnDescription(service));
  if (!owned.length) return config;

  const actions: Record<string, ActionConfig> = { ...config.actions };
  const apps = { ...config.apps };
  const secrets = { ...config.secrets };
  const clients = { ...config.clients };
  let api = config.api;
  let database = config.database;

  for (const [name, declared] of owned) {
    // Everything this service declares, with itself filled in wherever a `containerEnv` left it out.
    const service = inThisService(declared, name);
    for (const [actionName, action] of Object.entries(service.actions ?? {})) {
      // `grafana.signIn`, and it belongs to `grafana` — both of which the author had to type, and
      // either of which they could get wrong.
      // The service's recorder travels with its actions, so the runner does not have to look the
      // service up again to find out how to film one.
      actions[qualify(name, actionName)] = { app: name, records: service.records, shell: service.shell, ...action };
    }
    if (service.app) apps[name] = { service: name, ...service.app };
    for (const [secretName, secret] of Object.entries(service.secrets ?? {})) {
      // `{ "containerEnv": "KEY" }` inside a service means THAT service's container. Naming it again
      // is the thing the whole reorganisation was against, and it was the commonest line in the file.
      // Scoped, and resolved scope-first: two services with an `adminKey` is the normal case, and a
      // description that cannot say so forces one of them to be renamed to avoid the other.
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

/** What `DatabaseConfig.credential` used to be called, when it could only hold a literal. */
export const OLDER_NAME = "password";

/**
 * A secret written inside a service, with that service filled in.
 *
 * `{ "containerEnv": "ADMIN_KEY" }` is the short form and the one worth writing: the container is the
 * one this service runs in, which is what being written here already says.
 */
function inThisService<T>(within: T, service: string): T {
  if (Array.isArray(within)) return within.map(item => inThisService(item, service)) as T;
  if (!within || typeof within !== "object") return within;
  const from = within as Record<string, unknown>;
  if (typeof from.containerEnv === "string") return { ...from, containerEnv: { service, key: from.containerEnv } } as T;
  if (from.containerEnv && typeof from.containerEnv === "object" && !("service" in (from.containerEnv))) {
    return { ...from, containerEnv: { service, ...(from.containerEnv) } } as T;
  }
  // Anywhere inside the service, not just under `secrets`: a database's credential and an `auth`
  // block's are the same kind of thing, and a rule that only held in one place is a rule nobody can
  // remember.
  return Object.fromEntries(Object.entries(from).map(([key, value]) => [key, inThisService(value, service)])) as T;
}

/** `grafana` + `signIn` → `grafana.signIn`, and an already-qualified name is left alone. */
export function qualify(service: string, name: string): string {
  return name.startsWith(`${service}.`) ? name : `${service}.${name}`;
}

/**
 * A name as the service that owns it would find it, then as anyone would.
 *
 * `{secret.adminKey}` in one of grafana's actions means grafana's, and falls back to a shared one —
 * which is how a description says "this service's credential" and "our one CI token" without
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
