import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as path from "node:path";

/**
 * What every spec imports must be loadable by every runtime that loads specs.
 *
 * A test runner that transpiles to CommonJS cannot parse `import.meta`, so one file reachable from this
 * barrel that uses it breaks every spec in every consuming project — which is exactly what exporting
 * the skill generator from here did. The generators find witness's own sources that way, so they are
 * reachable from `bin/` and from their own subpath export, and not from here.
 */
const root = new URL(".", import.meta.url).pathname;

/** The code, without the comments — a rule about `import.meta` must not trip over a comment saying so. */
const code = (file: string): string => {
  try {
    return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  } catch {
    // A path this reader mistook for an import — the skill quotes `import { app } from "../app.ts"`
    // inside an example — is not evidence of anything.
    return "";
  }
};

/** Every local file reachable from a starting module, following relative imports. */
const reachable = (from: string): string[] => {
  const seen = new Set<string>();
  const queue = [path.resolve(root, from)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of code(file).matchAll(/from\s+"(\.[^"]+\.ts)"/g)) {
      queue.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  return [...seen];
};

test("nothing a spec imports reaches for `import.meta`", () => {
  const offenders = reachable("index.ts").filter(file => /import\.meta/.test(code(file)));
  equal(
    offenders.map(f => path.relative(root, f)).join(", "),
    "",
    "these are reachable from src/index.ts and use import.meta, which breaks every spec under a CommonJS runner",
  );
});

test("the generators are still reachable where they are meant to be", () => {
  // Not a rule against `import.meta` — a rule about where it may live.
  ok(reachable("skill/skill.ts").some(file => /import\.meta/.test(code(file))));
});
