#!/usr/bin/env node
import * as path from "node:path";

import { Cli, System, Workspace } from "../src/index.ts";
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

/** `witness init`: the directory, a description generated from the types, and what specs import. */
const init: Parameters<Cli["command"]>[1] = {
  summary: `make a ${Workspace.DIRECTORY}/ in this directory`,
  passthrough: (args: string[]) => {
    const root = args.find(a => !a.startsWith("--")) ?? process.cwd();
    const dir = path.join(path.resolve(root), Workspace.DIRECTORY);
    const entry = path.relative(dir, path.join(import.meta.dirname, "..", "src", "index.ts"));
    const { workspace, written } = Workspace.create(root, {
      "config.jsonc": Template.forWitness().render(),
      // Everything a run leaves behind lands here, and none of it belongs in a commit. Kept beside the
      // output rather than in the project's own .gitignore: this directory brings its own rules with it.
      ".gitignore": "# What runs leave behind. The description beside it is worth committing; this is not.\nartifacts/\n",
      "app.ts": `import { System } from "${entry}";\n\n/** The product this project describes. Specs import this. */\nexport const app = System.find();\n`,
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

Cli.main(system.addCommands({ config, init }).cli(), rest);
