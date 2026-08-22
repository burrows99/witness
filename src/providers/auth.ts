import { resolveSecret, secretProviders, type SecretSource } from "./secrets.ts";
import { Registry } from "./registry.ts";
import type { Stack } from "../environment/stack.ts";

/**
 * How a request proves who it is.
 *
 * Declared per client and named per operation, so a config can say "this route needs the service key,
 * that one needs the member's session" without either being a default. Adding OAuth or mTLS later is a
 * new provider here, not a change to anything that calls one.
 */
export type AuthConfig = {
  provider?: string;
  /** Header to send the credential in — `apiKey` and `bearer`. */
  header?: string;
  /** …or a cookie, for session auth. The value comes from the call. */
  cookie?: string;
  /** Where the credential comes from (see the secret providers). */
  from?: SecretSource;
  /** `basic`: who the credential belongs to. A secret source like any other. */
  username?: SecretSource;
  /** `login`: the request that mints a token, and where the token is in its answer. */
  login?: { url: string; body?: Record<string, unknown>; tokenPath?: string; headers?: Record<string, string> };
  /** `login`: extra headers derived from the login answer, e.g. a practice id. */
  derive?: Record<string, string>;
  /** Kept for compatibility with an older config shape. */
  fromContainerEnv?: { service: string; key: string };
  value?: string;
};

export type AuthContext = { stack: Stack; params: Record<string, unknown> };
/** A provider returns the headers a request should carry. */
export type AuthProvider = (config: AuthConfig, context: AuthContext) => Promise<Record<string, string>>;

/**
 * A value that NAMES a secret rather than being one.
 *
 * A login body is ordinary data with credentials in it, and the credentials are written the same way as
 * everywhere else — `{ "containerEnv": { … } }`. Recognising them by the provider they name is what
 * keeps a password out of the config file without having to guess at which fields are sensitive.
 */
const isSecret = (value: unknown): boolean =>
  typeof value === "string" ||
  (!!value && typeof value === "object" && Object.keys(value).length === 1 && secretProviders.has(Object.keys(value)[0]));

const credential = (config: AuthConfig, stack: Stack): string =>
  config.fromContainerEnv
    ? stack.env(config.fromContainerEnv.service, config.fromContainerEnv.key)
    : resolveSecret(config.from ?? config.value, stack);

export const authProviders = new Registry<AuthProvider>("auth")
  /** A key in a header — the shape of most service-to-service auth. */
  .register("apiKey", async (config, { stack }) => {
    const value = credential(config, stack);
    if (!value) throw new Error(`apiKey auth resolved to nothing (${JSON.stringify(config.from ?? config.fromContainerEnv)})`);
    return { [config.header ?? "X-API-KEY"]: value };
  })
  /** The same, as a bearer token. */
  .register("bearer", async (config, { stack }) => ({ Authorization: `Bearer ${credential(config, stack)}` }))
  /**
   * A username and a password, the way half the world's admin APIs still want them.
   *
   * Grafana, Elasticsearch, a Jenkins, anything behind a reverse proxy with htpasswd on it. The username
   * is a secret source like any other, because it is as likely to live in a container's environment as
   * the password is.
   */
  .register("basic", async (config, { stack }) => {
    const user = resolveSecret(config.username, stack);
    const password = credential(config, stack);
    if (!user || !password) {
      throw new Error(`basic auth needs a username and a password (got ${user ? "no password" : "no username"})`);
    }
    return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
  })
  /** A session cookie the caller already holds — `call(op, { sid })`. */
  .register("cookie", async (config, { params }) => {
    const name = config.cookie ?? "sid";
    const value = String(params[name] ?? params.sid ?? "");
    if (!value) throw new Error(`cookie auth "${name}" needs the value passed with the call`);
    return { Cookie: `${name}=${value}` };
  })
  /**
   * Sign in first, then carry what that returned.
   *
   * For the APIs whose credentials are a user rather than a key — a third party's internal API, most
   * often. The token is fetched once and reused; `derive` lifts anything else the callee needs out of
   * the login answer (a practice id, a tenant), which is the part that is usually undocumented.
   */
  .register("login", async (config, { stack }) => {
    const cached = logins.get(JSON.stringify(config.login));
    if (cached) return cached;
    if (!config.login) throw new Error("login auth needs a `login` block");

    const body = Object.fromEntries(
      Object.entries(config.login.body ?? {}).map(([k, v]) => [k, isSecret(v) ? resolveSecret(v as SecretSource, stack) : v]),
    );
    const res = await fetch(config.login.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.login.headers ?? {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`login ${config.login.url} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const answer = (await res.json()) as Record<string, unknown>;

    const pick = (path: string): string => {
      let cursor: unknown = answer;
      for (const key of path.split(".")) cursor = (cursor as Record<string, unknown> | undefined)?.[key];
      return typeof cursor === "string" ? cursor : String(cursor ?? "");
    };

    const headers: Record<string, string> = { Authorization: `Bearer ${pick(config.login.tokenPath ?? "token")}` };
    for (const [name, path] of Object.entries(config.derive ?? {})) headers[name] = pick(path);
    logins.set(JSON.stringify(config.login), headers);
    return headers;
  });

/** One sign-in per login block per run: these are real sessions on someone else's system. */
const logins = new Map<string, Record<string, string>>();

export function authHeaders(config: AuthConfig, context: AuthContext): Promise<Record<string, string>> {
  const provider = config.provider ?? (config.cookie ? "cookie" : "apiKey");
  return authProviders.get(provider)(config, context);
}
