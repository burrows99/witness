import type { Page } from "@playwright/test";

import { Actions, type ActionConfig, type ActionResult, type Params, resolveAction } from "./actions/engine.ts";
import { appSurface, type RouteMap, type Screens } from "./browser/surface.ts";
import { Cli, type Noun } from "./cli/cli.ts";
import { commandsFor } from "./cli/commands.ts";
import { fill, type DatabaseConfig, type SystemConfig, loadConfig, scoped } from "./config/index.ts";
import { locate } from "./browser/locator.ts";
import { resolveSecret } from "./providers/secrets.ts";
import { Evidence } from "./evidence/evidence.ts";
import type { EvidenceContext } from "./evidence/paths.ts";
import { HttpApi } from "./http/client.ts";
import { Operations } from "./http/operations.ts";
import { Postgres } from "./database/postgres.ts";
import { Queries } from "./database/queries.ts";
import { SignIn } from "./browser/sign-in.ts";
import { type StubServer, stubProviders } from "./providers/stubs.ts";
import { renderVideos } from "./evidence/render.ts";
import type { RenderOptions } from "./providers/video.ts";
import { Drift, type Report } from "./diagnostics/drift.ts";
import { Stack } from "./environment/stack.ts";
import { Workspace } from "./environment/workspace.ts";
import { Trace } from "./diagnostics/trace.ts";
import type { WebApp } from "./browser/web-app.ts";

/**
 * A system for whatever product a config file describes.
 *
 * There is nothing to subclass and no base class to extend: everything that differs between products —
 * services, operations, queries, routes, sign-in, the command line — is data, read from one JSON file.
 * Point it at a different file and it drives a different app.
 *
 * ```ts
 * export const app = System.fromConfig("e2e/acme.config.json");
 *
 * await app.customer.dashboard.open(page);            // routes, from the config
 * await app.api.call("orders.cancel", { orderId });   // operations, from the config
 * app.db.query("orders.status", { orderId });         // queries, from the config
 * ```
 *
 * What a config CANNOT describe — driving a third party's UI, filling a payment iframe, a stub server —
 * is ordinary code, attached with {@link use}. The line to hold: **a route is data, a behaviour is
 * code.** Pretending otherwise only hides the code somewhere worse.
 */
export class System {
  readonly config: SystemConfig;
  readonly stack: Stack;
  readonly api: Operations;
  readonly db: Queries;
  /** What the product can do, from the config's `actions` — every one returns its own evidence. */
  readonly actions: Actions;
  /** Everything the system has sent and run, with bodies. `app.trace.last` after a surprise. */
  readonly trace = new Trace();
  /** The apps the config declares, each with a screen per route. Also assigned onto the system by name. */
  readonly apps: Record<string, AppSurface>;

  /** The `.witness` directory this system was described by: everything it reads and writes is under it. */
  readonly workspace: Workspace;

  private readonly http?: HttpApi;
  private readonly postgres?: Postgres;
  private readonly commands: Record<string, Noun> = {};
  /** Where the description was read from — `video` re-reads it rather than holding a stale copy. */
  private configFile?: string;
  /** Set while something outside a test is driving: the frames belong with ITS recording, not `cli/adhoc`. */
  private pinned?: EvidenceContext;
  private readonly clients = new Map<string, Operations>();
  private readonly databases = new Map<string, Queries>();
  private readonly running = new Map<string, StubServer>();

  constructor(config: SystemConfig, workspace?: Workspace) {
    this.config = config;
    // A `.witness` directory names its own checkout — the parent. A description kept anywhere else
    // finds the checkout by walking up for the markers it declares.
    this.workspace = workspace ?? new Workspace({ dir: process.cwd(), configFile: "", found: "--config" });
    this.stack = new Stack({
      root: this.workspace.root ?? Stack.findRoot(config.root ?? [".git"]),
      services: config.services,
      suffixVar: config.suffixVar,
    });

    // The default client, plus any others the config declares — a third party's GraphQL is the same
    // kind of thing as our own API, not a special case.
    this.http = config.api ? new HttpApi(this.stack.endpoints[config.api.service], () => ({}), this.trace) : undefined;
    this.api = new Operations(
      this.http ?? new HttpApi(""),
      this.stack,
      config.api ?? { service: "", operations: {} },
      this.trace,
      // Scoped to the service whose API this is, so its `auth` can name that service's own
      // credentials — which is the whole point of them being written under it.
      name => this.secretOrNothing(name, config.api?.service),
    );
    for (const [clientName, spec] of Object.entries(config.clients ?? {})) {
      const base = this.stack.endpoints[spec.service];
      if (base === undefined) throw new Error(`client "${clientName}" names service "${spec.service}", which is not declared`);
      this.clients.set(
        clientName,
        // Scoped to the service that owns the client, so its `auth` can name its own secrets.
        new Operations(new HttpApi(base, () => ({}), this.trace), this.stack, spec, this.trace, name => this.secretOrNothing(name, clientName)),
      );
    }

    this.postgres = config.database ? this.driverFor(config.database) : undefined;
    this.db = new Queries(
      this.postgres ?? ({ sql: () => "", rows: () => [] } as unknown as Postgres),
      config.database?.queries,
    );
    // Every database the description names, by the service that runs it — the default one included,
    // so `--on=<service>` can reach any of them rather than every one except the interesting one. An
    // app database plus an authz or metrics one is completely ordinary; a second one is a second
    // database in the same sense a second API is a client, not a shape this refuses to load.
    if (config.database && this.postgres) this.databases.set(config.database.service, this.db);
    for (const [databaseName, spec] of Object.entries(config.databases ?? {})) {
      this.databases.set(databaseName, new Queries(this.driverFor(spec), spec.queries));
    }

    this.actions = new Actions({
      operations: this.api,
      client: (name: string) => this.client(name),
      queries: this.db,
      trace: this.trace,
      actions: config.actions ?? {},
      url: (appName, route, params) => this.routeUrl(appName, route, params),
      evidence: () => this.evidence(),
      // So an action can sign in without the caller typing a password on the command line — which is
      // the whole reason `secrets` exists, and was unreachable from a description until now.
      secret: (name: string, scope?: string) => this.secret(name, scope),
      // Where a step that leaves the app expects to land. Off the stack rather than out of the step,
      // so an identity provider's port is declared in the one place every other port is.
      origin: (service: string) => this.origin(service),
      // Where a file an `upload` step names lives. Under `.witness/` for the same reason the stubs and
      // the specs are: a description naming `seed.pdf` says the same thing in every checkout, and one
      // naming `/Users/somebody/Downloads/seed.pdf` works exactly once, on the machine that wrote it.
      fixtures: () => this.workspace.resolve(Workspace.FIXTURES),
      // What a failure looks like in a body, from every client that says — its own declaration, or the
      // one its wire format makes on its behalf. The debug story judged a request by its status code
      // alone until this reached it, so an app answering 200 with the failure in the payload — most
      // Python and PHP APIs, every polled job, and GraphQL by specification — read as healthy.
      failureWhen: [this.api, ...this.clients.values()].flatMap(client => client.failureWhen ?? []),
    });

    this.apps = {};
    for (const [name, spec] of Object.entries(config.apps ?? {})) {
      const site = appSurface(() => this.stack.endpoints[spec.service], (spec.routes ?? {}) as RouteMap) as AppSurface;

      /** Fill a declared form by field name — the placeholders that find the inputs live in the config. */
      site.fill = async (page: Page, form: string, values: Record<string, string>): Promise<void> => {
        const fields = spec.forms?.[form];
        if (!fields) throw new Error(`app "${name}" declares no form "${form}"`);
        for (const [field, value] of Object.entries(values)) {
          const placeholder = fields[field];
          if (!placeholder) throw new Error(`form "${form}" declares no field "${field}"`);
          const input = page.getByPlaceholder(placeholder);
          await input.click();
          await input.fill("");
          // Typed rather than filled: these forms get recorded, and `fill()` reads as a bot.
          await input.pressSequentially(value, { delay: 45 });
        }
      };

      /** A locator the config named, resolved against this page. */
      site.locator = (page: Page, locatorName: string) => {
        const found = spec.locators?.[locatorName];
        if (!found) throw new Error(`app "${name}" declares no locator "${locatorName}"`);
        return locate(page, found);
      };

      if (spec.signIn) {
        const signIn = new SignIn(site, this.api, this.db, spec.signIn);
        site.signIn = signIn.signIn.bind(signIn);
        site.signInLink = signIn.link.bind(signIn);
        site.session = signIn.session.bind(signIn);
        site.injectSession = signIn.inject.bind(signIn);
      }

      this.apps[name] = site;
      this.attach(name, site, "app");
    }
  }

  /** The system a config file describes. Its directory is the workspace. */
  static fromConfig(file: string): System {
    return System.of(Workspace.find({ config: file }));
  }

  /**
   * The system THIS project describes — the nearest `.witness/` above the working directory.
   *
   * What a product's entry point is: `export const app = System.find()`. No path to repeat, and the
   * answer does not depend on which directory a run or a shell happened to start in.
   */
  static find(opts: { from?: string } = {}): System {
    return System.of(Workspace.find(opts));
  }

  static of(workspace: Workspace): System {
    const system = new System(loadConfig(workspace.configFile), workspace);
    system.configFile = workspace.configFile;
    return system;
  }

  get endpoints(): Record<string, string> {
    return this.stack.endpoints;
  }

  get containers(): Record<string, string> {
    return this.stack.containers;
  }

  /**
   * Another API the config declares — `app.client("billing").call("invoices.list")`.
   *
   * A third party is a client like any other: its operations are declared, its auth is a provider, and
   * what it returns lands in the same trace. The only difference is whose software it is.
   */
  client(name: string): Operations {
    const found = this.clients.get(name);
    if (!found) throw new Error(`no client "${name}" — declared: ${[...this.clients.keys()].join(", ") || "none"}`);
    return found;
  }

  /**
   * Another database the config declares, by the service that runs it — `app.database("openfga-db")`.
   *
   * The same shape as {@link client}: `db` is the default one, this is every other. An app database
   * and an authz database is the ordinary case, and having nowhere to put the second was the reason a
   * generated config for such a stack could not be loaded at all.
   */
  database(name: string): Queries {
    const found = this.databases.get(name);
    if (!found) throw new Error(`no database "${name}" — declared: ${[...this.databases.keys()].join(", ") || "none"}`);
    return found;
  }

  /** The driver for one declared database. Lazily, so building a system never touches a container. */
  private driverFor(spec: DatabaseConfig): Postgres {
    return new Postgres({
      docker: this.stack.docker,
      container: () => this.stack.containers[spec.service],
      user: spec.user,
      database: spec.database,
      // Resolved here rather than passed through: `containerEnv` reads the running container, which
      // is not a thing a database driver should know how to do. Lazily, though — reading it now would
      // make `witness help` shell into a container, and fail when the stack is down.
      password: () => resolveSecret(spec.credential, this.stack),
      trace: this.trace,
    });
  }

  /**
   * Start a declared stub, or hand back the one already running.
   *
   * Idempotent because more than one action in a run may need the same stand-in, and starting it twice
   * would take a port the first one is answering on.
   */
  async stub(name: string): Promise<StubServer> {
    const already = this.running.get(name);
    if (already) return already;
    const spec = this.config.stubs?.[name];
    if (!spec) {
      throw new Error(`no stub "${name}" — declared: ${Object.keys(this.config.stubs ?? {}).join(", ") || "none"}`);
    }
    const started = await stubProviders.get(spec.provider ?? "http")(name, spec, this.workspace.dir, this.trace);
    this.running.set(name, started);
    return started;
  }

  /** Stop every stub this run started. */
  async stopStubs(): Promise<void> {
    for (const [name, server] of this.running) {
      await server.close();
      this.running.delete(name);
    }
  }

  /**
   * Take back down everything every client created — the end of a run, once.
   *
   * What gets reversed is declared on the operations that create things (`undo`), so this needs no list
   * of its own and cannot drift from one.
   */
  async undoAll(): Promise<number> {
    let undone = await this.api.undoAll();
    for (const client of this.clients.values()) undone += await client.undoAll();
    return undone;
  }

  /** Which services are ours and which belong to someone else. */
  services(kind?: "in-house" | "third-party"): string[] {
    return Object.entries(this.config.services)
      .filter(([, s]) => !kind || (s.kind ?? "in-house") === kind)
      .map(([name]) => name);
  }

  /** An identity the config declares (a dev-auth blob, a service account). */
  identity<T = Record<string, unknown>>(name: string): T {
    const found = this.config.identities?.[name];
    if (!found) throw new Error(`no identity "${name}" in the config`);
    return found as T;
  }

  /**
   * The cast: a fixture the config pins a scenario to.
   *
   * Real rows in a real database, named so an action can say who it is about. The config carries the
   * reasoning with them — which member has a linked patient record, whose name is unique in a shared
   * sandbox — because those are the facts that make a fixture the right one.
   */
  cast<T = CastEntry>(name?: string): T {
    if (!name) return (this.config.cast ?? {}) as T;
    const found = (this.config.cast ?? {})[name];
    if (found === undefined) throw new Error(`no cast member "${name}" in the config`);
    return found as T;
  }

  /**
   * Which declared action a name means — the question the runner asks before it opens anything.
   *
   * `gitea.createRepo` and, because only gitea declares one, `createRepo`. Throws naming what IS
   * declared, which is the whole of what a caller needs to type next.
   */
  resolveAction(name: string): string {
    return resolveAction(this.config.actions ?? {}, name);
  }

  /** Run a declared action, and get back everything it did. */
  run<T = unknown>(
    action: string,
    page: import("@playwright/test").Page,
    inputs: Params = {},
    within: { at?: string; quiet?: boolean } = {},
  ): Promise<ActionResult<T>> {
    return this.actions.run<T>(action, page, inputs, within);
  }

  /**
   * A credential the config knows where to find.
   *
   * The config says which file or which container holds it; the value never appears in the repo, and
   * nothing that logs (the trace included) ever prints it.
   */
  secret(name: string, scope?: string): string {
    // The service's own first, then a shared one: `{secret.password}` in grafana's action means
    // grafana's password, and two services with a `password` is the normal case.
    for (const candidate of scoped(name, scope?.includes(".") ? scope.slice(0, scope.indexOf(".")) : scope)) {
      const spec = this.config.secrets?.[candidate];
      // Handed the lookup so a secret can point at another one — an `auth` block naming the
      // credential the `secrets` block already declared, rather than respelling where it comes from.
      if (spec !== undefined) return resolveSecret(spec, this.stack, at => this.secretOrNothing(at, scope));
    }
    throw new Error(
      `no secret "${name}"${scope ? ` for ${scope}` : ""} — declared: ${Object.keys(this.config.secrets ?? {}).join(", ") || "none"}`,
    );
  }

  /** The same lookup, for something pointing at another secret — undefined rather than throwing. */
  private secretOrNothing(name: string, scope?: string): string | undefined {
    try {
      return this.secret(name, scope);
    } catch {
      return undefined;
    }
  }

  /** A container's environment — the running process, never the file it was created from. */
  env(service: string, key: string): string {
    return this.stack.env(service, key);
  }

  /**
   * Attach what a config cannot describe: a third party's client, a page object with real steps, a stub
   * server. Typed, and hung off the system by name.
   */
  use<N extends string, T>(name: N, make: (system: this) => T): this & { [K in N]: T } {
    this.attach(name, make(this), "extension");
    return this as this & { [K in N]: T };
  }

  /**
   * Hang something off the system by name, refusing to shadow what is already there.
   *
   * Declared names and built-in ones share a namespace, so an app called `db` or `api` would otherwise
   * replace the database or the API — and the failure surfaces much later as "this.db.sql is not a
   * function", which reads as a bug in the framework rather than a collision in the description.
   */
  private attach(name: string, value: unknown, kind: string): void {
    const reserved = ["api", "db", "stack", "apps", "actions", "trace", "config", "endpoints", "containers"];
    if (reserved.includes(name) || (name in this && !(name in this.apps))) {
      throw new Error(
        `${kind} "${name}" would shadow the system's own \`${name}\` — rename it in the config ` +
          `(reserved: ${reserved.join(", ")})`,
      );
    }
    (this as Record<string, unknown>)[name] = value;
  }

  /** Where a declared route lives, for whatever needs to go there. */
  routeUrl(appName: string, route: string, params: Params = {}): string {
    const target = this.apps[appName];
    if (!target) throw new Error(`action names app "${appName}", which the config does not declare`);
    const screen = (target as unknown as Record<string, { url: (p: Params) => string } | undefined>)[route];
    if (!screen) throw new Error(`app "${appName}" declares no route "${route}"`);
    return screen.url(params);
  }

  /**
   * Where one of the stack's services answers — for a step that leaves this app and has to say where
   * it is going.
   *
   * A service that publishes no port is a real case (a worker, a migration container) and it is a
   * different mistake from a name nobody declared, so the two say different things.
   */
  origin(service: string): string {
    const at = this.stack.endpoints[service];
    if (at) return at;
    const known = Object.keys(this.stack.endpoints);
    throw new Error(
      known.includes(service)
        ? `service "${service}" publishes no port, so there is no origin to land on`
        : `no service "${service}" — declared: ${known.join(", ") || "none"}`,
    );
  }

  /**
   * Whether the description still describes the thing.
   *
   * `as` names an action that signs somebody in — how this product does that is already described, so
   * there is no second way of saying it here.
   */
  async checkDrift(as?: string): Promise<Report & { rendered: string }> {
    const report = await Drift.sweep(this, as);
    return { ...report, rendered: Drift.render(report) };
  }

  /** Turn this run's recordings into MP4s. What the `video` command does, callable. */
  renderVideos(opts: RenderOptions = {}): string[] {
    try {
      return renderVideos(this.workspace, opts);
    } catch (err) {
      process.stderr.write(`[video] ${String(err).slice(0, 160)}\n`);
      return [];
    }
  }

  /** What the config says about one action — how it is recorded, and what its commands run inside. */
  actionConfig(name: string): ActionConfig | undefined {
    return this.config.actions?.[name];
  }

  /** Whether this description declares an API at all — what the command line asks before offering one. */
  get hasApi(): boolean {
    return Boolean(this.http);
  }

  /** The same question of a database. */
  get hasDatabase(): boolean {
    return Boolean(this.postgres);
  }

  /** Nouns something registered with `addCommands`, for whatever builds the command line. */
  get added(): Record<string, Noun> {
    return this.commands;
  }

  /** Command-line nouns beyond the ones the config generates. */
  addCommands(commands: Record<string, Noun>): this {
    Object.assign(this.commands, commands);
    return this;
  }

  /**
   * Evidence for whatever is running — `app.evidence().frame(page, "her dashboard")`.
   *
   * It takes no name: what was run and which cut it was already identify it, and deriving the path
   * from them is what makes two runs of the same thing land in the same place, and two different things
   * never collide.
   */
  evidence(): Evidence {
    const spec = this.config.evidence ?? {};
    return new Evidence({
      root: this.workspace.dir,
      base: spec.dir,
      links: () => (spec.links ?? []).map(l => this.expand(l)),
      context: this.pinned,
    });
  }

  /**
   * Say which run the evidence belongs to, for a driver that is not a test.
   *
   * Inside a test the runner already knows; from a shell nothing does, and every frame would otherwise
   * be filed under `cli/adhoc` — beside the frames of every other thing anyone ran from a shell.
   */
  pinEvidence(context: EvidenceContext | undefined): void {
    this.pinned = context;
  }

  /** `{service}` → that service's URL; `@service` → its container name. */
  expand(template: string): string {
    return fill(
      template.replace(/@(\w+)/g, (_, s: string) => this.containers[s] ?? `@${s}`),
      this.endpoints,
    );
  }

  /**
   * The command line this description gives you.
   *
   * Built elsewhere: assembling a product's parts and deciding what a command line looks like are two
   * jobs, and this class only has to be good at the first.
   */
  cli(): Cli {
    return commandsFor(this);
  }
}

/** An app the config declared: its routes as screens, its forms, and its sign-in if it has one. */
/** A cast entry is JSON: its shape is in the config, not in the type system. */
 
export type CastEntry = Record<string, any>;

export type AppSurface = WebApp &
  Screens<RouteMap> & {
    fill: (page: Page, form: string, values: Record<string, string>) => Promise<void>;
    locator: (page: Page, name: string) => import("@playwright/test").Locator;
    signIn?: SignIn["signIn"];
    signInLink?: SignIn["link"];
    session?: SignIn["session"];
    injectSession?: SignIn["inject"];
  };
