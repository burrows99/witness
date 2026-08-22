import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

import { fill } from "../config/index.ts";
import type { Trace } from "../diagnostics/trace.ts";
import { Registry } from "./registry.ts";

/**
 * Standing in for a third party the app calls SERVER-SIDE.
 *
 * Browser-level interception cannot help here: these requests leave the app's own process, so the only
 * place to answer them is a real server on a real port that the app is pointed at. And they have to be
 * answered, because the alternative is the real thing — which, depending on the vendor, dispatches a
 * person to an address or sends mail to a customer.
 *
 * A stub is declared, not written: routes with templated answers, a little state they can read and
 * change, and a record of everything that arrived. That last part is usually the point — "the app called
 * out with this payload" is a claim about a request nobody can otherwise see.
 *
 * It is deliberately NOT a mocking framework. If a stub grows conditionals, the honest move is a real
 * sandbox from the vendor, or a container that implements their protocol properly.
 */
export type StubRoute = {
  method?: string;
  /** `/v1/appointments/{id}` — `{name}` captures a path segment. */
  path: string;
  status?: number;
  /** A JSON answer. `{body.x}`, `{param}`, `{seq}`, `{origin}` and `{found}` are filled in. */
  json?: unknown;
  /** …or an HTML file, filled the same way. Keeps a page that is HTML in a file that is HTML. */
  html?: string;
  /** Append an item to a named collection, and answer with it unless `json` says otherwise. */
  append?: { to: string; item: Record<string, unknown> };
  /** Set top-level state values. */
  set?: Record<string, unknown>;
  /** Look one item up; `{found}` is then available, and a miss answers 404. */
  find?: { in: string; where: Record<string, string> };
  /** Change the item `find` matched. */
  update?: Record<string, unknown>;
  summary?: string;
};

export type StubConfig = {
  provider?: string;
  port: number;
  /**
   * How the app reaches it. Usually not `localhost`: the app is normally in a container, and the stub
   * is on the host.
   */
  reachableAs?: string;
  /** Starting state — the collections routes append to and read from. */
  state?: Record<string, unknown>;
  routes: StubRoute[];
  /**
   * Wait for the port instead of failing on it.
   *
   * One environment variable points the app at one stub, so two specs stubbing the same vendor cannot
   * both be up: they have to take turns. Waiting is what makes that work on parallel workers.
   */
  waitForPort?: boolean;
  why?: string;
};

/** What a spec holds: the state the stub accumulated, and the requests it saw. */
export class StubServer {
  readonly name: string;
  readonly url: string;
  /** The URL to point the app at (`reachableAs`, defaulting to the local one). */
  readonly reachableAs: string;
  readonly state: Record<string, unknown>;
  readonly requests: { method: string; path: string; body: unknown; at: string }[] = [];

  private readonly server: Server;

  constructor(opts: { name: string; url: string; reachableAs: string; state: Record<string, unknown>; server: Server }) {
    this.name = opts.name;
    this.url = opts.url;
    this.reachableAs = opts.reachableAs;
    this.state = opts.state;
    this.server = opts.server;
  }

  /** A collection the routes append to. */
  collection<T = Record<string, unknown>>(name: string): T[] {
    return (this.state[name] ?? []) as T[];
  }

  /**
   * Wait until something in a collection matches — the third party's side of an asynchronous flow.
   *
   * The app sends mail, or a webhook fires, and the spec cannot continue until it has arrived. Polling
   * here rather than in every spec keeps the timeout in one place and the failure message useful.
   */
  async waitFor<T = Record<string, unknown>>(
    collection: string,
    matches: (item: T) => boolean,
    opts: { timeout?: number; label?: string } = {},
  ): Promise<T> {
    const deadline = Date.now() + (opts.timeout ?? 60_000);
    for (;;) {
      const found = this.collection<T>(collection).find(matches);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `stub "${this.name}": nothing in ${collection} matched ${opts.label ?? "the condition"} ` +
            `within ${opts.timeout ?? 60_000}ms (${this.collection(collection).length} seen)`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      this.server.closeAllConnections?.();
      this.server.close(() => resolve());
    });
  }
}

export type StubProvider = (name: string, config: StubConfig, root: string, trace?: Trace) => Promise<StubServer>;

/** Match a declared path against a real one, capturing `{name}` segments. */
const match = (pattern: string, actual: string): Record<string, string> | undefined => {
  const declared = pattern.split("/");
  const got = actual.split("/");
  if (declared.length !== got.length) return undefined;
  const params: Record<string, string> = {};
  for (const [i, part] of declared.entries()) {
    const capture = part.match(/^\{(\w+)\}$/);
    if (capture) params[capture[1]] = decodeURIComponent(got[i]);
    else if (part !== got[i]) return undefined;
  }
  return params;
};

/** Fill `{placeholders}` at any depth; a string that is exactly one placeholder keeps its value's type. */
const template = (value: unknown, values: Record<string, unknown>): unknown => {
  if (typeof value === "string") {
    const whole = value.match(/^\{([\w.]+)\}$/);
    if (whole) {
      const found = whole[1].split(".").reduce<unknown>((cursor, key) => (cursor as never)?.[key], values);
      if (found !== undefined) return found;
    }
    return value.replace(/\{([\w.]+)\}/g, (_, path: string) => {
      const found = path.split(".").reduce<unknown>((cursor, key) => (cursor as never)?.[key], values);
      return found === undefined ? `{${path}}` : String(found);
    });
  }
  if (Array.isArray(value)) return value.map(v => template(v, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, template(v, values)]));
  }
  return value;
};

export const stubProviders = new Registry<StubProvider>("stub").register("http", async (name, config, root, trace) => {
  const state: Record<string, unknown> = structuredClone(config.state ?? {});
  const url = `http://localhost:${config.port}`;
  let seq = 0;
  let stub: StubServer;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestPath = new URL(req.url ?? "/", url).pathname;
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      const body: unknown = raw ? safeJson(raw) : {};
      stub?.requests.push({ method: req.method ?? "GET", path: requestPath, body, at: new Date().toISOString() });
      trace?.add({
        kind: "http",
        operation: `stub:${name}`,
        method: req.method ?? "GET",
        url: requestPath,
        requestBody: body,
        ms: 0,
        at: new Date().toISOString(),
      });

      for (const route of config.routes) {
        if (route.method && route.method !== req.method) continue;
        const params = match(route.path, requestPath);
        if (!params) continue;

        seq += 1;
        const values: Record<string, unknown> = { ...params, body, seq, origin: url, state, now: new Date().toISOString() };

        let found: Record<string, unknown> | undefined;
        if (route.find) {
          const where = template(route.find.where, values) as Record<string, string>;
          found = (state[route.find.in] as Record<string, unknown>[] | undefined)?.find(item =>
            Object.entries(where).every(([k, v]) => String(item[k]) === String(v)),
          );
          if (!found) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: { message: `no ${route.find.in} matching ${JSON.stringify(where)}` } }));
          }
          values.found = found;
        }

        if (route.update && found) Object.assign(found, template(route.update, values));

        let appended: unknown;
        if (route.append) {
          appended = template(route.append.item, values);
          const into = (state[route.append.to] ??= []) as unknown[];
          into.push(appended);
          values.item = appended;
        }

        if (route.set) Object.assign(state, template(route.set, values));

        if (route.html) {
          const file = path.isAbsolute(route.html) ? route.html : path.join(root, route.html);
          res.writeHead(route.status ?? 200, { "Content-Type": "text/html" });
          return res.end(String(template(fs.readFileSync(file, "utf8"), values)));
        }

        const answer = route.json !== undefined ? template(route.json, values) : (appended ?? found ?? { ok: true });
        res.writeHead(route.status ?? 200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(answer));
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `stub "${name}" declares no route for ${req.method} ${requestPath}` } }));
    });
  });

  await listen(server, config, name);
  stub = new StubServer({
    name,
    url,
    reachableAs: config.reachableAs ? fill(config.reachableAs, { port: config.port }) : url,
    state,
    server,
  });
  return stub;
});

/**
 * Take the port, waiting for it if the config says to.
 *
 * Exactly one listener of each kind, attached up front: passing a callback to `listen()` registers a
 * fresh `listening` handler on every retry, which trips Node's max-listeners warning after ten.
 */
function listen(server: Server, config: StubConfig, name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 10 * 60_000;
    server.once("listening", resolve);
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EADDRINUSE" || !config.waitForPort) return reject(err);
      if (Date.now() > deadline) return reject(new Error(`stub "${name}": port ${config.port} still busy`));
      setTimeout(() => server.listen(config.port), 2000);
    });
    server.listen(config.port);
  });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Not every caller sends JSON — AWS's SES API posts form-encoded bodies, for one.
    return Object.fromEntries(new URLSearchParams(raw));
  }
}
