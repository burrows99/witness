import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as path from "node:path";

/**
 * Playwright, if this project has it.
 *
 * An optional peer dependency in the honest sense. Half of what this package does — finding a stack,
 * asking an API, reading a database, standing in for a third party — has nothing to do with a browser,
 * and a package that imports its optional peer at the top of a file makes "optional" a word in a
 * manifest rather than something true: `witness init` in a project with no browser would fail on an
 * import of a test runner it was never going to use.
 *
 * Resolved from the PROJECT rather than from this file, so a package installed under `node_modules`
 * finds the copy the project runs, and one loaded from a checkout finds the one beside it. Synchronous
 * because the callers are: a fixture is built while a runner is loading files, and `test.info()` is
 * asked for from a getter.
 */
let resolved: typeof import("@playwright/test") | null | undefined;

export function playwright(): typeof import("@playwright/test") | undefined {
  if (resolved === undefined) {
    try {
      const from = createRequire(pathToFileURL(path.join(process.cwd(), "witness.js")));
      resolved = from("@playwright/test") as typeof import("@playwright/test");
    } catch {
      resolved = null;
    }
  }
  return resolved ?? undefined;
}

/** The same, for the half that cannot do anything without it. */
export function requirePlaywright(what: string): typeof import("@playwright/test") {
  const found = playwright();
  if (!found) {
    throw new Error(`${what} needs Playwright, which this project does not have — npm i -D @playwright/test`);
  }
  return found;
}
