import { deepEqual, equal, match } from "node:assert/strict";
import { test } from "node:test";

import { Docker } from "../environment/docker.ts";
import { Postgres } from "./postgres.ts";
import { Trace } from "../diagnostics/trace.ts";

/** A docker that answers with `rows` and keeps the command it was asked to run. */
const psql = (rows: string): { db: Postgres; ran: string[][]; trace: Trace } => {
  const ran: string[][] = [];
  const trace = new Trace();
  const docker = new Docker({
    cli: args => {
      ran.push(args);
      return rows;
    },
  });
  return { db: new Postgres({ docker, container: "acme-postgres", user: "acme", database: "acme", password: "pw", trace }), ran, trace };
};

test("a query goes through the container's own psql", () => {
  // No driver, no connection pool to leak, and it works against whatever the container has.
  const { db, ran } = psql("cancelled");
  equal(db.sql("select status from orders where id = 1"), "cancelled");
  deepEqual(ran[0], [
    "exec",
    "-e",
    "PGPASSWORD=pw",
    "acme-postgres",
    "psql",
    "-U",
    "acme",
    "-d",
    "acme",
    "-tAc",
    "select status from orders where id = 1",
  ]);
});

test("the container can be resolved at call time, not at construction", () => {
  // A worktree's container name is only known once the stack has been resolved.
  const ran: string[][] = [];
  let name = "acme-postgres";
  const db = new Postgres({
    docker: new Docker({
      cli: args => {
        ran.push(args);
        return "";
      },
    }),
    container: () => name,
    user: "acme",
    database: "acme",
    password: "pw",
  });
  db.sql("select 1");
  name = "acme-postgres-583";
  db.sql("select 1");
  deepEqual([ran[0][3], ran[1][3]], ["acme-postgres", "acme-postgres-583"]);
});

test("rows come back as objects, aggregated by the database rather than parsed here", () => {
  const { db, ran } = psql('[{"id":"1","status":"cancelled"}]');
  deepEqual(db.rows("select id, status from orders"), [{ id: "1", status: "cancelled" }]);
  match(ran[0][ran[0].length - 1], /SELECT COALESCE\(json_agg\(t\), '\[\]'\) FROM \(select id, status from orders\) t/);
});

test("nothing found is an empty list, not a parse error", () => {
  const { db } = psql("[]");
  deepEqual(db.rows("select 1 where false"), []);
});

test("every statement reaches the trace, with what it answered", () => {
  const { db, trace } = psql("cancelled");
  db.sql("select status from orders", "order.status");
  const entry = trace.last as { kind: string; query?: string; statement: string; rows: string };
  equal(entry.kind, "sql");
  equal(entry.query, "order.status");
  equal(entry.statement, "select status from orders");
  equal(entry.rows, "cancelled");
});
