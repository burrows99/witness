import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import { TypeSource, type TypeModel } from "./types.ts";

const read = (source: string): TypeSource => new TypeSource().read(source);
const fields = (model: TypeModel): Record<string, TypeModel> => {
  ok(model.kind === "object", `expected an object, got ${model.kind}`);
  return Object.fromEntries(model.fields.map(f => [f.name, f.type]));
};

test("indexes every exported type", () => {
  const types = read("export type A = { a: string };\nexport type B = string;\ntype Private = number;");
  deepEqual(types.names, ["A", "B"]);
  ok(types.has("A"));
  ok(!types.has("Private"));
});

test("an unknown type says what it does know", () => {
  throws(() => read("export type A = string;").declaration("Nope"), /no exported type "Nope" — read: A/);
});

test("optional and required members are told apart", () => {
  const model = read("export type A = { needed: string; optional?: number };").declaration("A");
  ok(model.kind === "object");
  deepEqual(model.fields.map(f => [f.name, f.optional]), [["needed", false], ["optional", true]]);
});

test("doc comments come across, block and line alike", () => {
  const model = read(`export type A = {
    /** Why this exists. */
    a: string;
    /**
     * A longer one.
     * Over two lines.
     */
    b: string;
    // A line comment counts too.
    c: string;
    d: string;
  };`).declaration("A");
  ok(model.kind === "object");
  deepEqual(model.fields.map(f => f.doc), ["Why this exists.", "A longer one. Over two lines.", "A line comment counts too.", undefined]);
});

test("a comment containing a URL does not end the declaration", () => {
  const model = read(`export type A = {
    /** See https://example.com/docs; it explains the shape. */
    a: string;
    b: string;
  };`).declaration("A");
  ok(model.kind === "object");
  deepEqual(model.fields.map(f => f.name), ["a", "b"]);
});

test("records, arrays and arrays of objects", () => {
  const types = read(`export type A = {
    map: Record<string, string>;
    nested: Record<string, Record<string, number>>;
    list: string[];
    // The one that used to be read as an object, swallowing the [] into its last member's type.
    rows: { name: string; on?: boolean }[];
  };`);
  const a = fields(types.declaration("A"));
  deepEqual(a.map, { kind: "record", of: { kind: "primitive", name: "string" } });
  ok(a.nested.kind === "record" && a.nested.of.kind === "record");
  deepEqual(a.list, { kind: "array", of: { kind: "primitive", name: "string" } });
  ok(a.rows.kind === "array");
  deepEqual(Object.keys(fields(a.rows.of)), ["name", "on"]);
});

test("unions of literals, and unions with a shape in them", () => {
  const types = read(`export type Kind = "in-house" | "third-party";
  export type Probe = "http" | { path?: string; status?: number };`);
  deepEqual(types.declaration("Kind"), { kind: "union", of: [{ kind: "literal", text: "in-house" }, { kind: "literal", text: "third-party" }] });
  const probe = types.declaration("Probe");
  ok(probe.kind === "union" && probe.of[1].kind === "object");
});

test("a union written with a leading pipe over several lines", () => {
  const model = read(`export type S =
    | string
    | { containerEnv: { service: string; key: string } }
    | { literal: string };`).declaration("S");
  ok(model.kind === "union");
  equal(model.of.length, 3);
});

test("an intersection keeps the fields and drops the open half", () => {
  const model = read("export type A = Record<string, unknown> & { cookies?: string };").declaration("A");
  deepEqual(Object.keys(fields(model)), ["cookies"]);
});

test("an intersection keeps the fields of a NAMED half too", () => {
  // `ServiceConfig = ServiceSpec & { … }` is how a service says "where it runs, and everything else
  // that is true about it". A reference is not an object, so taking fields only from the half written
  // inline dropped `port`, `portVar`, `container` and `kind` — every field of where a service RUNS —
  // out of the one command that claims to print every field there is.
  const types = read(`export type Spec = { port?: number; portVar?: string };
  export type Service = Spec & { app?: string };`);
  deepEqual(Object.keys(fields(types.declaration("Service"))), ["port", "portVar", "app"]);
});

test("an index signature becomes a record", () => {
  const model = read("export type A = { [key: string]: number };").declaration("A");
  ok(model.kind === "object");
  deepEqual(model.fields.map(f => f.name), ["*"]);
});

test("a reference to another declared type stays a reference", () => {
  const types = read("export type A = { b: B };\nexport type B = { c: string };");
  deepEqual(fields(types.declaration("A")).b, { kind: "ref", name: "B" });
});

test("a self-reference is a reference like any other — the renderer breaks the cycle", () => {
  const types = read("export type L = { within?: L; css?: string };");
  deepEqual(fields(types.declaration("L")).within, { kind: "ref", name: "L" });
});

test("a type this reader does not model is kept verbatim rather than guessed at", () => {
  const a = fields(read("export type A = { fn: (x: string) => void; imported: SomeOther };").declaration("A"));
  ok(a.fn.kind === "opaque");
  match(a.fn.text, /=> void/);
  // Not declared anywhere we read, so it cannot be expanded — but the name is still what the type says.
  deepEqual(a.imported, { kind: "opaque", text: "SomeOther" });
});

test("a semicolon inside a string does not end the declaration", () => {
  const model = read(`export type A = { sql: "select 1; select 2"; after: string };`).declaration("A");
  deepEqual(Object.keys(fields(model)), ["sql", "after"]);
});

test("declarations parse the same twice — the second read is cached, not re-derived", () => {
  const types = read("export type A = { a: string };");
  equal(types.declaration("A"), types.declaration("A"));
});

test("witness's own schema reads cleanly", () => {
  // The reader exists for exactly one input; anything it cannot model in it would show up as `opaque`.
  const types = TypeSource.fromDirectory(new URL("..", import.meta.url).pathname);
  const config = types.declaration("SystemConfig");
  ok(config.kind === "object");
  deepEqual(config.fields.slice(0, 3).map(f => f.name), ["name", "root", "services"]);
  ok(config.fields.every(f => f.type.kind !== "opaque"), "no top-level field of SystemConfig should be unmodelled");
});

test("Omit is read as the type minus what its position already says", () => {
  // `Omit<AppConfig, "service">` is how a service's own `app` says "and you need not name the service
  // again". Read as opaque, the generated template showed `{}` and the TypeScript source of the very
  // field an author is meant to fill in.
  const types = new TypeSource().read(`
    export type AppConfig = { service: string; routes?: Record<string, string>; title: string };
    export type ServiceConfig = { app?: Omit<AppConfig, "service"> };
  `);
  const service = types.declaration("ServiceConfig");
  ok(service.kind === "object");
  const app = service.fields[0].type;
  ok(app.kind === "object", `expected an object, got ${app.kind}`);
  deepEqual(app.fields.map(f => f.name), ["routes", "title"]);
});

test("a reference is followed through its aliases before its fields are taken", () => {
  // `Omit<ApiConfig, "service">`, where `ApiConfig` is an alias for `ClientConfig`. Stopping at the
  // first declaration found another reference, which has no fields to keep — so a service's `api`
  // came out holding the one field the `Omit` was there to REMOVE, and nothing else.
  const types = new TypeSource().read(`
    export type Client = { service: string; provider?: string; operations: Record<string, string> };
    export type Api = Client;
    export type ServiceConfig = { api?: Omit<Api, "service"> };
  `);
  const service = types.declaration("ServiceConfig");
  ok(service.kind === "object");
  deepEqual(Object.keys(fields(service.fields[0].type)), ["provider", "operations"]);
});

test("Omit of more than one key drops all of them", () => {
  const types = new TypeSource().read(`
    export type Thing = { a: string; b: string; c: string };
    export type Less = Omit<Thing, "a" | "b">;
  `);
  const less = types.declaration("Less");
  ok(less.kind === "object");
  deepEqual(less.fields.map(f => f.name), ["c"]);
});
