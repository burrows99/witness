import { deepEqual, equal, match, throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { fill, loadConfig, withoutComments } from "./load.ts";

test("fill puts values into placeholders", () => {
  equal(fill("/v1/orders/{id}", { id: 7 }), "/v1/orders/7");
  equal(fill("{a}-{b}-{a}", { a: "x", b: "y" }), "x-y-x");
  equal(fill("nothing to fill"), "nothing to fill");
});

test("fill refuses to leave a placeholder blank", () => {
  // A silently empty path segment is a request to the wrong URL, and the 404 that follows blames the app.
  throws(() => fill("/v1/orders/{id}"), /missing \{id\}/);
  throws(() => fill("{id}", { id: undefined }), /missing \{id\}/);
});

test("a doubled brace is text, not a parameter nobody supplied", () => {
  // Not every string that reaches `fill` was written as a template. `docker ps --format '{{.Names}}'`
  // is a command somebody meant literally, and reading `{.Names}` out of it threw on a step that has
  // no parameters in it at all — so the command could not be recorded, at all, by any description.
  equal(fill("docker ps --format '{{.Names}}'"), "docker ps --format '{{.Names}}'");
  equal(fill("{{.Names}}\t{{.Ports}}"), "{{.Names}}\t{{.Ports}}");
  // And a real placeholder beside one still fills.
  equal(fill("{host} {{.Names}}", { host: "witness" }), "witness {{.Names}}");
});

test("withoutComments removes line and block comments", () => {
  equal(withoutComments('{ // why\n "a": 1 }').replace(/\n/g, ""), '{  "a": 1 }');
  equal(withoutComments('{ /* why */ "a": 1 }'), '{  "a": 1 }');
  equal(withoutComments('{ "a": 1 } // trailing, no newline'), '{ "a": 1 } \n');
});

test("withoutComments leaves comment-shaped text inside strings alone", () => {
  // Half the URLs in a config contain `//`, which is the whole reason this is not a regex.
  const source = '{ "url": "https://api.example.com/v1", "note": "/* not a comment */" }';
  deepEqual(JSON.parse(withoutComments(source)), { url: "https://api.example.com/v1", note: "/* not a comment */" });
});

test("withoutComments survives escaped quotes", () => {
  const source = '{ "q": "she said \\"//\\" out loud" } // real comment';
  deepEqual(JSON.parse(withoutComments(source)), { q: 'she said "//" out loud' });
});

test("withoutComments keeps the line count so a parse error still points somewhere", () => {
  const source = '{\n // one\n // two\n "a": 1\n}';
  equal(withoutComments(source).split("\n").length, source.split("\n").length);
});

test("loadConfig reads a file with comments in it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "witness-load-"));
  const file = path.join(dir, "acme.config.json");
  writeFileSync(file, '// the acme stack\n{ "name": "acme", "root": ["x"], "services": {} }\n');
  equal(loadConfig(file).name, "acme");
  match(loadConfig(file).root!.join(), /x/);
});

test("a dotted name reaches into what a step stored", () => {
  // Comparing one layer against another was the last thing a description could not say: the API's
  // answer is an object and what the screen gave back is a list, and neither has a flat name.
  equal(fill("{stats.dashboards}", { stats: { dashboards: 3 } }), "3");
  equal(fill("{rows.length}", { rows: ["a", "b"] }), "2");
  equal(fill("{a.b.c}", { a: { b: { c: "deep" } } }), "deep");
});

test("a JSON string a step kept whole is looked inside, not treated as opaque", () => {
  // An `api` step stores what it got back, which is text. The reason to keep it was to look in it.
  equal(fill("{answer.users}", { answer: '{"users":1}' }), "1");
});

test("a dotted name that leads nowhere is the same error as a missing one", () => {
  throws(() => fill("{stats.dashboards}", { stats: { users: 1 } }), /missing \{stats\.dashboards\}/);
  throws(() => fill("{nope.deep}", {}), /missing \{nope\.deep\}/);
});

test("an object is filled in as JSON, not as [object Object]", () => {
  // A step that keeps what an API answered keeps an object. Interpolated into a caption, a note or a
  // URL it produced the useless form — silently, in the files written to be read afterwards.
  equal(fill("it said {answer}", { answer: { status: "ok" } }), 'it said {"status":"ok"}');
  equal(fill("rows: {rows}", { rows: [1, 2] }), "rows: [1,2]");
  // Everything else is unchanged.
  equal(fill("{n} of {total}", { n: 8, total: 226 }), "8 of 226");
  equal(fill("{flag}", { flag: false }), "false");
});
