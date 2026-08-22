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
