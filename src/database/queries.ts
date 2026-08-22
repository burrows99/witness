import { fill } from "../config/index.ts";
import type { Postgres } from "./postgres.ts";

/**
 * The database as a named set of queries.
 *
 * Same reasoning as {@link Operations}: what a system reads and writes out of band is worth having in
 * one readable list rather than scattered through specs as SQL strings. It also makes the dangerous half
 * obvious — anything that writes is right there to be reviewed.
 *
 * `sql()` stays available for the genuinely one-off read.
 */
export class Queries {
  readonly names: string[];

  private readonly postgres: Postgres;
  private readonly queries: Record<string, string>;

  constructor(postgres: Postgres, queries: Record<string, string> = {}) {
    this.postgres = postgres;
    this.queries = queries;
    this.names = Object.keys(queries);
  }

  statement(name: string): string {
    const sql = this.queries[name];
    if (!sql) throw new Error(`no such query "${name}" — see the config's database.queries`);
    return sql;
  }

  /** One value, or one column. */
  query(name: string, params: Record<string, unknown> = {}): string {
    return this.postgres.sql(fill(this.statement(name), params), name);
  }

  /** Rows as objects. */
  rows<T = Record<string, unknown>>(name: string, params: Record<string, unknown> = {}): T[] {
    return this.postgres.rows<T>(fill(this.statement(name), params));
  }

  /** Raw SQL, for the read that does not deserve a name. */
  sql(statement: string): string {
    return this.postgres.sql(statement);
  }
}
