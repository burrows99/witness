import type { Docker } from "../environment/docker.ts";
import { Trace } from "../diagnostics/trace.ts";

/**
 * The stack's database, read out of band.
 *
 * Out of band is the point: the screen is evidence of what the app rendered, the API of what it answered,
 * and neither is evidence of what was STORED. Reach for this to assert state, and to seed the
 * preconditions no endpoint can create — not as a shortcut around the app, because a row written by hand
 * is a row the app never agreed to.
 *
 * Goes through `docker exec psql` rather than a driver: no dependency, no connection pool to leak, and it
 * works against whatever the container has regardless of what the host has installed.
 */
export class Postgres {
  private readonly docker: Docker;
  private readonly container: () => string;
  private readonly user: string;
  private readonly database: string;
  private readonly password: () => string;

  private readonly trace?: Trace;

  constructor(opts: {
    docker: Docker;
    container: string | (() => string);
    user: string;
    database: string;
    /**
     * The credential, asked for when a query runs.
     *
     * A thunk for the same reason `container` is one. `containerEnv` reads a RUNNING container, so
     * resolving it eagerly made building a system fail whenever the stack was down — and building a
     * system is what `witness help` does. A generated config that named a database broke every
     * command until the stack came up, which is precisely backwards.
     */
    password: string | (() => string);
    trace?: Trace;
  }) {
    this.trace = opts.trace;
    this.docker = opts.docker;
    this.container = typeof opts.container === "function" ? opts.container : () => opts.container as string;
    this.user = opts.user;
    this.database = opts.database;
    this.password = typeof opts.password === "function" ? opts.password : () => opts.password as string;
  }

  /** One value, or one column — `-tAc`: no header, no padding. */
  sql(query: string, name?: string): string {
    const started = Date.now();
    const rows = this.docker.exec(
      this.container(),
      ["psql", "-U", this.user, "-d", this.database, "-tAc", query],
      { PGPASSWORD: this.password() },
    );
    this.trace?.add({
      kind: "sql",
      query: name,
      statement: query,
      rows: String(Trace.clip(rows)),
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
    return rows;
  }

  /** Rows as objects, for the reads worth seeing whole. */
  rows<T = Record<string, unknown>>(query: string): T[] {
    return JSON.parse(this.sql(`SELECT COALESCE(json_agg(t), '[]') FROM (${query}) t`)) as T[];
  }
}
