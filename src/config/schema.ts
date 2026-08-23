import type { ActionConfig } from "../actions/engine.ts";
import type { LocatorSpec } from "../browser/locator.ts";
import type { ClientConfig } from "../providers/clients.ts";
import type { StubConfig } from "../providers/stubs.ts";
import type { VideoConfig } from "../providers/video.ts";
import type { SecretSource } from "../providers/secrets.ts";
import type { ServiceSpec } from "../environment/stack.ts";

/**
 * The description of one product, as data.
 *
 * Everything a system needs to know that DIFFERS between products is here: where the services are, what
 * the API can do, what the queries are, which routes a person visits, how someone is signed in. The
 * system itself holds no product knowledge at all — point it at a different config file and it drives a
 * different app.
 *
 * Read at runtime rather than `import`ed, because these files are loaded by two runtimes (Node directly
 * for the CLI, a bundler for anything importing this) and JSON module semantics differ
 * between them. `fs.readFileSync` behaves the same in both.
 */
export type SystemConfig = {
  /** What the command line is called. */
  name: string;
  /**
   * Marker files that identify the checkout root, walked up from the working directory.
   *
   * Only for a description kept OUTSIDE a `.witness/` directory: that directory already names its own
   * checkout — the parent — so a project using the convention needs none of this. Defaults to `.git`.
   */
  root?: string[];
  services: Record<string, ServiceSpec>;
  /**
   * Who the system can be. An identity with `cookies` is injected into every browser context the
   * system opens — the dev-auth blob a staff app trusts locally, and the reason a run needs no login.
   */
  identities?: Record<string, IdentityConfig>;
  /**
   * The cast: the real rows a scenario is pinned to, and why that one. Data, so it lives here rather
   * than in a TypeScript file nobody can read from a shell.
   */
  cast?: Record<string, unknown>;
  /** Where credentials come from. Never the values themselves — see the secret providers. */
  secrets?: Record<string, SecretSource>;
  /** What the product can DO — sequences of steps, with everything they touch declared. */
  actions?: Record<string, ActionConfig>;
  api?: ApiConfig;
  database?: DatabaseConfig;
  apps?: Record<string, AppConfig>;
  evidence?: { dir?: string; links?: string[] };
  /** How the run's recordings become MP4s. See the video providers. */
  video?: VideoConfig;
  /**
   * Local stand-ins for third parties the app calls SERVER-SIDE.
   *
   * Declared here because every product has at least one: something that charges a card, sends mail or
   * dispatches a person, which a test must not actually do.
   */
  stubs?: Record<string, StubConfig>;
  /** Extra API clients beyond the default one — a third party's GraphQL, say. */
  clients?: Record<string, ClientConfig>;
  cli?: Record<string, CliGroupConfig>;
};

export type IdentityConfig = Record<string, unknown> & {
  /** Cookies to inject into every context. `value` is JSON-encoded when `json` is set. */
  cookies?: { name: string; domain?: string; path?: string; json?: unknown; value?: string; urlEncode?: boolean }[];
};

/**
 * The default API client.
 *
 * Identical in shape to any other client — the only thing that makes it the default is that an action reaches
 * it as `app.api` rather than `app.client(name)`. Its wire format, auth and operations are all providers'
 * business, which is why the types come from there.
 */
export type ApiConfig = ClientConfig;

export type DatabaseConfig = {
  service: string;
  user: string;
  database: string;
  password: string;
  /** Named SQL, with `{param}` placeholders. Keeping them here means one place to read what we assert. */
  queries?: Record<string, string>;
};

export type AppConfig = {
  service: string;
  /** Screen name → path. `{param}` makes it a route that takes an argument. */
  routes?: Record<string, string>;
  /** Named forms on those screens: field name → the placeholder that finds the input. */
  forms?: Record<string, Record<string, string>>;
  /**
   * Named locators — the handful of things an action asserts on directly.
   *
   * Named rather than spelled out at the call site for the same reason routes are: when the markup
   * changes, one line changes.
   */
  locators?: Record<string, LocatorSpec>;
  /** How someone is signed in to this app. */
  signIn?: SignInConfig;
};

/**
 * A magic-link sign-in: mint a token through the API, hand it to the app, let the app authenticate.
 *
 * Common enough to be worth describing rather than coding — an impersonation link, a passwordless email
 * link and a support "log in as" button are all the same three steps.
 */
export type SignInConfig = {
  /** The operation that mints the link. It must return a URL. */
  mint: string;
  /** Which query parameter of that URL carries the token. */
  tokenParam?: string;
  /** Where the browser takes the token — on THIS app's origin, not the API's configured one. */
  landing: string;
  /** Where to wait for the app to redirect to once it has authenticated. */
  landsOn?: string;
  /** Exchanging the token for a session cookie, for the API-only path (`session()`). */
  exchange?: { operation: string; cookie: string };
  /**
   * Queries to run when a session is INJECTED into a browser (`injectSession`), with `{sid}` available.
   *
   * Apps commonly mark a link-minted session as staff-driven and behave differently for it — suppressed
   * analytics, a banner. Un-marking it is the only way to record what an ordinary sign-in looks like,
   * and it belongs here rather than in every action that needs it.
   */
  afterInject?: { query: string; params?: Record<string, string> }[];
};

export type CliGroupConfig = {
  summary?: string;
  /**
   * verb → what it runs.
   *
   * An operation on the default API, an operation on a named client, a query, or one of an app's
   * sign-in capabilities. Between them that is everything a product's command line has turned out to
   * need — anything still requiring code is a gap in this list, not a reason for a bespoke entry point.
   */
  verbs: Record<
    string,
    {
      operation?: string;
      /** Which client the operation belongs to. Omit for the default API. */
      client?: string;
      query?: string;
      /** `{ signIn: "member" }` — the deep-link that app's sign-in mints. */
      signIn?: string;
      summary?: string;
      args?: string[];
    }
  >;
};
