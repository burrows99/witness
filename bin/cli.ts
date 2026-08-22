#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

import { Cli, System, Workspace } from "../src/index.ts";
import { Skill } from "../src/skill/skill.ts";
import { Template } from "../src/config/template.ts";

/**
 * The command line, for whatever system a config file describes.
 *
 * A product does not write one of these. Everything a command line needs — which services exist, what
 * can be asked of them, what the shorthand verbs are — is in the description already, so the executable
 * is the same for every product and only the config differs.
 *
 *     witness init                        make a .witness/ here
 *     witness stack status                the nearest .witness/ above the working directory
 *     witness --config acme/other.json stack status
 *
 * A product that registers code extensions (`system.use(...)`) and wants them on its command line can
 * still ship its own three-line entry point — but needing one should be rare enough to notice.
 */
const argv = process.argv.slice(2);
const flag = argv.indexOf("--config");
const configFile = flag >= 0 ? argv[flag + 1] : undefined;
const rest = flag >= 0 ? [...argv.slice(0, flag), ...argv.slice(flag + 2)] : argv;

/**
 * The description, and where it comes from.
 *
 * Registered before anything is loaded, because both of these are what you reach for when there is no
 * description yet or when the one being read is not the one you meant.
 */
const config: Parameters<Cli["command"]>[1] = {
  summary: "the description this tool reads, and where it comes from",
  verbs: {
    template: {
      summary: "print a config file with every field witness understands, and its documentation",
      raw: true,
      run: () => Template.forWitness().render(),
    },
    where: {
      summary: "which description is in force here, and why",
      raw: true,
      run: () => {
        const workspace = Workspace.find({ config: configFile });
        return {
          config: workspace.configFile,
          directory: workspace.dir,
          checkout: workspace.root ?? "(from the config's `root` markers)",
          found: workspace.found,
          from: process.cwd(),
        };
      },
    },
  },
};

/**
 * What the generated entry point should import.
 *
 * The package name when this is running from an install, and the path to the sources when it is running
 * from a checkout of itself — a generated file that points into `node_modules` is one that breaks the
 * first time anything is reinstalled.
 */
function entryPoint(dir: string): string {
  const here = import.meta.dirname;
  if (here.includes(`${path.sep}node_modules${path.sep}`)) {
    for (let at = here; at !== path.dirname(at); at = path.dirname(at)) {
      const manifest = path.join(at, "package.json");
      if (fs.existsSync(manifest)) return (JSON.parse(fs.readFileSync(manifest, "utf8")) as { name: string }).name;
    }
  }
  return path.relative(dir, path.join(here, "..", "src", "index.ts"));
}

/**
 * `witness skill`: how to use this, generated from what this copy can actually do.
 *
 * Its own command rather than a verb under `config`, because it is not about the description — and it
 * has to answer before there is one, which is the moment somebody most needs it.
 */
const skill: Parameters<Cli["command"]>[1] = {
  summary: "how to use this, generated from what this copy can do — regenerate after an upgrade",
  passthrough: () => {
    process.stdout.write(`${describe()}\n`);
  },
};

/** With a description, the instructions name that product's own apps, actions, operations and queries. */
function describe(opts: { quiet?: boolean } = {}): string {
  try {
    return Skill.for({ system: System.fromConfig(Workspace.find({ config: configFile }).configFile) }).render();
  } catch (err) {
    // Falling back is right — the instructions are useful before a description exists. Falling back
    // SILENTLY is not: the generic version names commands this project does not have, and the reader
    // has no way to know they are reading the wrong thing.
    // `init` is the one caller for which having no description yet is the normal case.
    if (!opts.quiet) {
      process.stderr.write(
        `[skill] describing the tool generically: this project's own config could not be read — ` +
          `${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return Skill.for().render();
  }
}

/** `witness init`: the directory, a description generated from the types, and what specs import. */
const init: Parameters<Cli["command"]>[1] = {
  summary: `make a ${Workspace.DIRECTORY}/ in this directory`,
  passthrough: (args: string[]) => {
    const root = args.find(a => !a.startsWith("--")) ?? process.cwd();
    const dir = path.join(path.resolve(root), Workspace.DIRECTORY);
    const entry = entryPoint(dir);
    // The same question as `entry`, for the runner's reporter: a package subpath when this is installed,
    // a path when it is a checkout. Naming the package in a project that vendors witness is a config
    // that cannot load — which is exactly what witness's own example did.
    const reporter = entry.startsWith(".") ? entry.replace(/index\.ts$/, "evidence/reporter.ts") : `${entry}/reporter`;
    const { workspace, written } = Workspace.create(root, {
      "config.jsonc": Template.forWitness().render(),
      // How to use this, generated from what this copy can actually do — so an agent that opens the
      // directory finds instructions rather than having to infer the tool from its own source.
      "SKILL.md": describe({ quiet: true }),
      // Everything a run leaves behind lands here, and none of it belongs in a commit. Kept beside the
      // output rather than in the project's own .gitignore: this directory brings its own rules with it.
      ".gitignore": "# What runs leave behind. The description beside it is worth committing; this is not.\nartifacts/\n",
      // Everything a spec needs, from one place. A spec that has to name the package works only in a
      // project that installed it under that name — and the second thing anyone writes is a spec.
      "app.ts": [
        `import { beat, caption, slide, System, testFor } from "${entry}";`,
        "",
        "/** The product this project describes. */",
        "export const app = System.find();",
        "",
        "/** The runner, with this project's identities already in every browser context it opens. */",
        "export const test = testFor(app);",
        "",
        'export { expect } from "@playwright/test";',
        "export { beat, caption, slide };",
        "",
      ].join("\n"),
      // A runner, so a spec can be written on the first day rather than after inventing a config: what
      // to run, where recordings go, the teardown that renders them, and the reporter that says where
      // to read what happened.
      "playwright.config.ts": [
        'import { defineConfig, devices } from "@playwright/test";',
        "",
        "/**",
        " * The runner for the specs in this directory. Everything it writes lands under `artifacts/`,",
        " * which is where the video provider looks and what the .gitignore beside it ignores.",
        " */",
        "export default defineConfig({",
        '  testDir: "./specs",',
        '  outputDir: "./artifacts/test-results",',
        '  globalTeardown: "./teardown.ts",',
        "  fullyParallel: false,",
        "  workers: 1,",
        "  timeout: 120_000,",
        "  // The list reporter says what passed; the other says where to read what happened when it did not.",
        `  reporter: [["list"], ["${reporter}"]],`,
        "  use: {",
        '    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",',
        '    ...devices["Desktop Chrome"],',
        "    viewport: { width: 1280, height: 900 },",
        '    video: { mode: "on", size: { width: 1280, height: 900 } },',
        "    // Playwright's own trace: the DOM at every action, the network with bodies, the sources.",
        '    trace: "on",',
        "  },",
        "});",
        "",
      ].join("\n"),
      // A spec, so `specs/` exists and the runner has something to find. `testDir` pointing at a
      // directory nobody created answers "No tests found", which says nothing about what to do.
      "specs/first.spec.ts": [
        // From `app.ts`, never from the package: a spec that names the package works only in a project
        // that installed it under that name, and this file is the shape every other spec is copied from.
        'import { app, caption, expect, test } from "../app.ts";',
        "",
        "/**",
        " * The first thing this project needs to prove.",
        " *",
        " * Describe an app and an action in `config.jsonc` first (`witness config template` documents",
        " * every field, `witness action list` says what you have), then delete the `.skip` below.",
        " */",
        'test.skip("what this project needs to prove", async ({ page }) => {',
        "  const evidence = app.evidence();",
        "",
        '  await caption(page, "About to do the thing", "so the recording says what is happening");',
        '  const run = await app.run("your.action", page, { some: "input" });',
        "  expect(run.ok).toBe(true);",
        "",
        "  // Assert at the layer the claim is about: the screen, the API, or what was stored.",
        '  await evidence.frame(page, "what it looks like now");',
        "  await evidence.manualVerification({",
        '    title: "What this shows",',
        '    notes: ["how a person re-walks this by hand"],',
        "  });",
        "});",
        "",
      ].join("\n"),
      "teardown.ts": [
        `import { teardownFor } from "${entry.replace(/\/index\.ts$/, "/index.ts")}";`,
        "",
        "/** After the run: turn the recordings into MP4s, filed with the rest of each test's evidence. */",
        "export default teardownFor();",
        "",
      ].join("\n"),
    });
    process.stdout.write(
      written.length
        ? `${written.map(f => `wrote ${path.relative(process.cwd(), f)}`).join("\n")}\n` +
            `\nEdit ${path.relative(process.cwd(), workspace.configFile)} down to what your product has, then:\n` +
            `  witness stack status\n`
        : `${path.relative(process.cwd(), workspace.dir)}/ already has everything — nothing written\n`,
    );
  },
};

if (rest[0] === "init") {
  init.passthrough!(rest.slice(1));
  process.exit(0);
}

// Before a description exists is exactly when the instructions are worth having.
if (rest[0] === "skill") {
  skill.passthrough!([]);
  process.exit(0);
}

// `config template` describes a product before there is a description to load, and `config where` has
// to answer when what it would load is missing or broken — which is when it is asked.
if (rest[0] === "config" && !configFile) {
  const verb = config.verbs![rest[1] ?? ""];
  if (!verb) Cli.die(`unknown: config ${rest[1] ?? ""}`.trim(), 2);
  const answer = verb.run(rest.slice(2));
  process.stdout.write(typeof answer === "string" ? `${answer}\n` : `${JSON.stringify(answer, null, 2)}\n`);
  process.exit(0);
}

let system: System;
try {
  system = configFile ? System.fromConfig(configFile) : System.find();
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}

Cli.main(system.addCommands({ config, init, skill }).cli(), rest);
