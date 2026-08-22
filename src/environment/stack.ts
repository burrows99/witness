import * as fs from "node:fs";
import * as path from "node:path";

import { Docker } from "./docker.ts";

/**
 * Where the running stack IS — the one thing every other part of a system needs and the one thing that
 * differs between checkouts.
 *
 * A stack is described twice: once to `docker compose` and once to whatever drives it. When those two
 * descriptions are written separately they drift, and a run ends up driving one stack while reading
 * another's database. So this reads the SAME `.env` compose reads, and derives both from it:
 *
 *   · a service's URL   = `http://localhost:${<PORT_VAR> or its default}`
 *   · a service's container = `<name><suffix>`, where the suffix is one variable (a worktree's `WT`)
 *
 * An explicit environment variable still wins over the file, for a one-off run against something else.
 *
 * Nothing here knows what the services ARE — pass the map in. See `README.md`.
 */
export class Stack {
  /** The checkout this run belongs to: the directory holding the marker files passed to `find`. */
  readonly root: string;
  /** The compose project suffix, applied to every container name (`""` for the primary checkout). */
  readonly suffix: string;
  readonly endpoints: Record<string, string>;
  readonly containers: Record<string, string>;
  readonly docker: Docker;

  private readonly probes: Record<string, ServiceSpec["probe"]>;

  constructor(spec: StackSpec) {
    this.root = spec.root;
    this.docker = spec.docker ?? new Docker();
    const compose = Stack.readEnvFile(path.join(this.root, spec.envFile ?? ".env"));
    this.suffix = process.env[spec.suffixVar ?? "WT"] ?? compose[spec.suffixVar ?? "WT"] ?? "";

    this.endpoints = Object.fromEntries(
      Object.entries(spec.services).map(([name, s]) => [
        name,
        process.env[s.urlVar ?? ""] ??
          (s.url ? s.url : `http://localhost:${s.portVar ? (compose[s.portVar] ?? s.port) : s.port}`),
      ]),
    );

    this.probes = Object.fromEntries(Object.entries(spec.services).map(([name, s]) => [name, s.probe]));

    this.containers = Object.fromEntries(
      Object.entries(spec.services)
        .filter(([, s]) => s.container)
        .map(([name, s]) => [name, process.env[s.containerVar ?? ""] ?? `${s.container}${this.suffix}`]),
    );
  }

  /** Read a variable out of one of the stack's containers. */
  env(service: string, key: string): string {
    const container = this.containers[service];
    if (!container) throw new Error(`no container declared for service "${service}"`);
    return this.docker.env(container, key);
  }

  /**
   * Is each service answering, and is its container up? For a `status` command.
   *
   * A service is probed the way it can be: over HTTP by default, but a database answers no HTTP request
   * ever, so `probe: "container"` asks docker instead — otherwise a perfectly healthy Postgres reads as
   * DOWN and sends whoever is debugging down the wrong path.
   */
  async status(): Promise<StackStatus[]> {
    const running = this.docker.running();
    return Promise.all(
      Object.entries(this.endpoints).map(async ([name, url]) => {
        const container = this.containers[name];
        const containerUp = container ? running.includes(container) : undefined;
        const probe = this.probes[name];
        let reachable: boolean;
        let answering: string | undefined;

        if (probe === "container") {
          reachable = containerUp ?? false;
        } else {
          const spec = typeof probe === "object" ? probe : {};
          try {
            const res = await fetch(`${url}${spec.path ?? ""}`, {
              signal: AbortSignal.timeout(4000),
              redirect: "manual",
            });
            const body = spec.contains ? await res.text() : "";
            reachable =
              (spec.status === undefined || res.status === spec.status) &&
              (spec.contains === undefined || body.includes(spec.contains));
            // It answered, but not the way this service answers: somebody else owns the port.
            if (!reachable) answering = `something that is not ${name} answers ${url}`;
          } catch {
            reachable = false;
          }
        }

        // A declared container that is NOT the one publishing the port means somebody else's software
        // is answering. Neither up nor down — and the most expensive thing to discover later.
        const port = Number(new URL(url).port);
        if (container && port) {
          const publisher = this.docker.publisher(port);
          if (publisher && publisher !== container) answering = `${publisher} publishes this port, not ${container}`;
        }

        return { name, url, reachable, container, containerUp, answering };
      }),
    );
  }

  /** A `KEY=value` file as an object. A missing file is not an error — it means "all defaults". */
  static readEnvFile(file: string): Record<string, string> {
    try {
      const out: Record<string, string> = {};
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      return out;
    } catch {
      return {};
    }
  }

  /**
   * Find the checkout root by walking UP from the working directory, looking for marker files.
   *
   * Walking up rather than resolving from a module's own location, because these files get loaded by two
   * different runtimes: a test runner that transpiles them to CommonJS (where `__dirname` exists) and
   * Node running them directly as ES modules (where it does not). The working directory is the one
   * answer both give — and in a worktree it resolves to the worktree, which is the point.
   */
  static findRoot(markers: string[]): string {
    let dir = process.cwd();
    while (dir !== path.dirname(dir)) {
      if (markers.every(m => fs.existsSync(path.join(dir, m)))) return dir;
      dir = path.dirname(dir);
    }
    throw new Error(`no checkout root above ${process.cwd()} containing ${markers.join(" + ")}`);
  }
}

export type ServiceSpec = {
  /** Default published port. Overridden by `portVar` in the compose `.env`. */
  port?: number;
  portVar?: string;
  /** A fixed URL instead of localhost:port (a remote environment, say). */
  url?: string;
  /** Environment variable that overrides the URL outright. */
  urlVar?: string;
  /** Container name WITHOUT the worktree suffix. Omit for a service that runs on the host. */
  container?: string;
  containerVar?: string;
  /**
   * How `status` decides it is up.
   *
   * `"http"` (the default) asks for the URL; `"container"` asks docker, for anything that answers no
   * HTTP request ever. The object form additionally says how to RECOGNISE the service, which is what
   * separates "something is listening" from "our thing is listening" when two projects share a machine.
   */
  probe?: "http" | "container" | { path?: string; status?: number; contains?: string };
  /**
   * Ours or someone else's.
   *
   * Worth saying out loud: a third party is not restartable, not resettable, usually shared with other
   * people's runs, and the thing most likely to make a spec flaky for reasons that are nobody's fault.
   */
  kind?: "in-house" | "third-party";
};

export type StackSpec = {
  root: string;
  services: Record<string, ServiceSpec>;
  /** Defaults to `.env` next to the compose file. */
  envFile?: string;
  /** The variable holding the container-name suffix. Defaults to `WT`. */
  suffixVar?: string;
  docker?: Docker;
};

export type StackStatus = {
  name: string;
  url: string;
  reachable: boolean;
  container?: string;
  containerUp?: boolean;
  /** Why we believe something OTHER than this service is answering. Human-readable. */
  answering?: string;
};
