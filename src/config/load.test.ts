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
