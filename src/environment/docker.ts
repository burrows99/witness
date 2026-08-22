import { execFileSync } from "node:child_process";

/**
 * The containers a local stack runs in.
 *
 * Everything here shells out to the docker CLI rather than talking to the daemon: a system runs beside
 * `docker compose`, and the CLI is the one interface that is always present and always agrees with what
 * compose just did.
 */
export class Docker {
  /** How the docker CLI is run. Injectable so what parses its output can be tested without a daemon. */
  private readonly cli: (args: string[]) => string;

  constructor(opts: { cli?: (args: string[]) => string } = {}) {
    this.cli = opts.cli ?? (args => execFileSync("docker", args, { encoding: "utf8" }));
  }

  /** Run a command inside a container and return its stdout, trimmed. */
  exec(container: string, args: string[], env: Record<string, string> = {}): string {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    return this.cli(["exec", ...envArgs, container, ...args]).trim();
  }

  /**
   * Read a variable out of the RUNNING container.
   *
   * Not out of the `.env` file it was created from: a container keeps the values it had at create time,
   * so after an edit-without-recreate the two disagree — and the process serving requests is the one
   * telling the truth. Cached, because a key is read many times per run and never changes mid-run.
   */
  env(container: string, key: string): string {
    const at = `${container}/${key}`;
    const hit = this.envCache.get(at);
    if (hit !== undefined) return hit;
    const value = this.exec(container, ["printenv", key]);
    this.envCache.set(at, value);
    return value;
  }

  /** The names of every running container. */
  running(): string[] {
    return this.cli(["ps", "--format", "{{.Names}}"]).trim().split("\n").filter(Boolean);
  }

  isRunning(container: string): boolean {
    return this.running().includes(container);
  }

  /**
   * Which container publishes a host port, if any.
   *
   * The question `stack status` actually needs: not "is something listening" but "is it OURS". Two
   * projects on one machine collide constantly, and a probe that cannot tell them apart reports a
   * stack as ready when none of it is running.
   */
  publisher(port: number): string | undefined {
    const rows = this.cli(["ps", "--format", "{{.Names}}\t{{.Ports}}"]);
    for (const row of rows.trim().split("\n")) {
      const [name, ports] = row.split("\t");
      // `0.0.0.0:8080->8080/tcp` but also `0.0.0.0:8080-8081->8080-8081/tcp`: docker collapses adjacent
      // ports into a range, and a matcher that only knows the single form misses the container entirely.
      for (const mapping of (ports ?? "").split(", ")) {
        const m = /^(?:[\d.]+|\[[^\]]+\]):(\d+)(?:-(\d+))?->/.exec(mapping);
        if (m && port >= Number(m[1]) && port <= Number(m[2] ?? m[1])) return name;
      }
    }
    return undefined;
  }

  private readonly envCache = new Map<string, string>();
}
