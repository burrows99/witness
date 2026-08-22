import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import type { Postgres } from "./postgres.ts";
import { Queries } from "./queries.ts";

const postgres = (): { db: Postgres; ran: string[] } => {
  const ran: string[] = [];
  const db = {
    sql: (statement: string) => {
      ran.push(statement);
      return "answer";
    },
    rows: <T>(statement: string) => {
      ran.push(statement);
      return [{ id: "1" }] as T[];
    },
  } as unknown as Postgres;
  return { db, ran };
};

const queries = {
  "order.status": "select status from orders where id = '{orderId}'",
  "member.count": "select count(*) from members",
};

test("a named query is filled with its parameters and run", () => {
  const { db, ran } = postgres();
  equal(new Queries(db, queries).query("order.status", { orderId: 7 }), "answer");
  deepEqual(ran, ["select status from orders where id = '7'"]);
});

test("rows come back as objects", () => {
  const { db } = postgres();
  deepEqual(new Queries(db, queries).rows("member.count"), [{ id: "1" }]);
});

test("the queries are listed, which is what makes them reviewable", () => {
  deepEqual(new Queries(postgres().db, queries).names, ["order.status", "member.count"]);
  equal(new Queries(postgres().db, queries).statement("member.count"), "select count(*) from members");
});

test("an unknown query points at where they are declared", () => {
  throws(() => new Queries(postgres().db, queries).query("nope"), /no such query "nope" — see the config's database.queries/);
});

test("a query missing a parameter fails rather than running with a hole in it", () => {
  // `where id = ''` is a query that runs, returns nothing, and reads as "the row is not there".
  throws(() => new Queries(postgres().db, queries).query("order.status"), /missing \{orderId\}/);
});

test("raw SQL stays available for the read that does not deserve a name", () => {
  const { db, ran } = postgres();
  new Queries(db, {}).sql("select 1");
  deepEqual(ran, ["select 1"]);
});
