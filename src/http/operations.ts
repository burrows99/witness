import type { ClientConfig, ClientProvider, OperationConfig, Params } from "../providers/clients.ts";
import { clientProviders } from "../providers/clients.ts";
import type { HttpApi } from "./client.ts";
import { authHeaders } from "../providers/auth.ts";
import type { ClientContext } from "../providers/clients.ts";
import type { Stack } from "../environment/stack.ts";
import type { Trace } from "../diagnostics/trace.ts";

/**
 * One API, as a named set of operations.
 *
 * Every request the system can make is declared in the config, so "what can this thing do" is
 * answerable by reading one file — and the same list drives the command line. A spec calls an operation
 * by name and passes its parameters; nothing hand-builds a URL.
 *
 * The wire format is a provider (`rest`, `graphql`, …), so a third party's GraphQL is the same kind of
 * thing as our own REST API rather than a special case with its own client class.
 */
export class Operations {
  readonly names: string[];
  readonly provider: string;

  private readonly http: HttpApi;
  private readonly stack: Stack;
  private readonly trace: Trace;
  private readonly config: ClientConfig;
  /** The credentials the description declares, so an `auth` block can point at one by name. */
  private readonly declared?: (name: string) => string | undefined;
  private readonly client: ClientProvider;
  private readonly created: { operation: string; param: string; id: string }[] = [];

  constructor(http: HttpApi, stack: Stack, config: ClientConfig, trace: Trace, declared?: (name: string) => string | undefined) {
    this.declared = declared;
    this.http = http;
    this.stack = stack;
    this.trace = trace;
    this.config = config;
    this.provider = config.provider ?? "rest";
    this.client = clientProviders.get(this.provider);
    this.names = Object.keys(config.operations ?? {});

    // A guard for the clients that can delete: refuse to run against anything but the expected host.
    if (config.requireUrlMatch && !new RegExp(config.requireUrlMatch).test(http.baseUrl)) {
      throw new Error(`refusing to use ${http.baseUrl}: it does not match ${config.requireUrlMatch}`);
    }
  }

  operation(name: string): OperationConfig {
    const op = this.config.operations?.[name];
    if (!op) throw new Error(`no such operation "${name}" — declared: ${this.names.slice(0, 12).join(", ")}…`);
    return op;
  }

  /** The URL an operation would hit, for the specs that navigate to it or name it in a note. */
  url(name: string, params: Params = {}): string {
    return this.client.url(this.operation(name), params, this.context());
  }

  /**
   * Run one operation.
   *
   * `params` fill the path (or the document's placeholders); `body` is merged over the operation's own
   * template. Session auth reads its cookie value out of `params`, so asking the API something AS a
   * signed-in user is `call("x", { sid })`.
   */
  async call<T = unknown>(name: string, params: Params = {}, body?: unknown): Promise<T> {
    const op = this.operation(name);
    const answer = await this.client.call<T>(name, op, params, body, this.context());

    // If the operation says how to reverse itself, remember what it just made.
    if (op.undo) {
      let cursor: unknown = answer;
      for (const key of (op.undo.idPath ?? "id").split(".")) cursor = (cursor as Record<string, unknown> | undefined)?.[key];
      if (cursor) this.created.push({ operation: op.undo.operation, param: op.undo.param, id: String(cursor) });
    }
    return answer;
  }

  /**
   * Reverse everything this client created, newest first.
   *
   * Call it from a spec's `finally`. Failures are reported, never thrown: a cleanup that aborts halfway
   * leaves more behind than one that keeps going.
   */
  async undoAll(): Promise<number> {
    let undone = 0;
    for (const item of this.created.splice(0).reverse()) {
      try {
        await this.call(item.operation, { [item.param]: item.id });
        undone += 1;
      } catch (err) {
        process.stderr.write(`[cleanup] ${item.operation} ${item.id}: ${String(err).slice(0, 160)}\n`);
      }
    }
    return undone;
  }

  /**
   * Run one operation for every item another returned.
   *
   * The shape of most third-party cleanup: list what matches, then delete each. Declared as two
   * operations and joined here, rather than as a bespoke method per third party.
   */
  async callForEach(list: string, params: Params, each: string, param: string, idPath = "id"): Promise<number> {
    const items = await this.call<Record<string, unknown>[]>(list, params);
    for (const item of items ?? []) {
      let cursor: unknown = item;
      for (const key of idPath.split(".")) cursor = (cursor as Record<string, unknown> | undefined)?.[key];
      await this.call(each, { ...params, [param]: String(cursor) });
    }
    return (items ?? []).length;
  }

  /**
   * A request the config does not name — the escape hatch.
   *
   * If you reach for this twice for the same route, give it a name in the config instead: that list is
   * what makes the system readable.
   */
  async request<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    // Authenticated the way a declared operation would be: with this client's service credential. An
    // escape hatch that silently drops auth is worse than no escape hatch — it 403s and looks like the
    // app's fault.
    const scheme = Object.values(this.config.auth ?? {}).find(a => a.from || a.fromContainerEnv || a.value);
    const headers = scheme ? await authHeaders(scheme, { stack: this.stack, params: {}, declared: this.declared }) : {};
    return this.http.request<T>(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  }

  private context(): ClientContext {
    return { http: this.http, stack: this.stack, trace: this.trace, config: this.config, declared: this.declared };
  }
}

export type { Params };
