import { ok } from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { playwright } from "./playwright.ts";

/**
 * A directory with nothing installed in it and nothing above it either — the shape a `witness` on the
 * path gets pointed at. `os.tmpdir()` has no `node_modules` anywhere up its tree, which is the whole
 * point of standing in it: whatever answers here was not reached from the working directory.
 *
 * One test, and it calls `playwright()` once, because the answer is memoised for the life of the
 * module. `node --test` gives a file its own process, so the memo starts empty here.
 */
test("resolves Playwright from beside the tool when the working directory has none", () => {
  const here = process.cwd();
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "witness-no-modules-")));
  try {
    ok(playwright(), "the copy npm installs beside this package should answer when the project has none");
  } finally {
    process.chdir(here);
  }
});
