import { realpathSync } from "node:fs";
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
 * Looked for in two places, in this order. The PROJECT first, so a checkout or an installed dependency
 * drives the version its own tests and its recorded locators were written against. Then THE RUNNING
 * COMMAND, so a `witness` on the path can be pointed at a project that has nothing installed in it —
 * the walk up from a global `dist/bin/cli.js` reaches `<prefix>/lib/node_modules`, which is where
 * `npm i -g @playwright/test` puts it. One browser per machine rather than one per project.
 *
 * A resolution change and not a dependency one: the manifest is untouched, npm still installs nothing
 * on its own, and a bare `npm i -g @burrows99/witness` still has no browser and still says so. What it
 * stops doing is making a tool whose pitch is "point it at your stack" demand a dev dependency *of that
 * stack* — the intrusion `--config`-outside-the-repo exists to avoid.
 *
 * `argv[1]` rather than `import.meta.url`, which reads better and cannot be used: a spec transpiled to
 * CommonJS cannot parse it, and this file is reachable from the barrel every spec imports (there is a
 * test for that). `realpathSync` because a global `bin/` entry is a symlink Node leaves unresolved in
 * `argv[1]`, and the unresolved path walks up an entirely different tree. Nothing is running when there
 * is no script — `node -e`, a REPL — and then the project was the only honest answer anyway.
 *
 * Synchronous because the callers are: a fixture is built while a runner is loading files, and
 * `test.info()` is asked for from a getter.
 */
let resolved: typeof import("@playwright/test") | null | undefined;

export function playwright(): typeof import("@playwright/test") | undefined {
  if (resolved === undefined) {
    resolved = from(() => pathToFileURL(path.join(process.cwd(), "witness.js"))) ?? from(() => realpathSync(process.argv[1])) ?? null;
  }
  return resolved ?? undefined;
}

/**
 * One anchor's worth of the question. The anchor is a thunk because working one out can throw as
 * readily as resolving from it can — an unresolvable symlink and a missing package are the same
 * answer here, which is "not this way".
 */
function from(anchor: () => URL | string): typeof import("@playwright/test") | undefined {
  try {
    return createRequire(anchor())("@playwright/test") as typeof import("@playwright/test");
  } catch {
    return undefined;
  }
}

/** The same, for the half that cannot do anything without it. */
export function requirePlaywright(what: string): typeof import("@playwright/test") {
  const found = playwright();
  if (!found) {
    throw new Error(
      `${what} needs Playwright, which is neither in this project nor beside this tool — npm i -D @playwright/test, or npm i -g @playwright/test to keep the project untouched`,
    );
  }
  return found;
}
