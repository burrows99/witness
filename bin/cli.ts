#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

import { Cli, System, Workspace } from "../src/index.ts";
import { Author } from "../src/config/write.ts";
import { Compose } from "../src/config/compose.ts";
import { Explore } from "../src/config/explore.ts";
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
 * A fragment, from wherever the caller has one.
 *
 * `-` is stdin and is the form that matters: `config explore <service> | config merge -` is the loop
 * this whole writing half exists to close, and it is a pipeline or it is nothing. Required rather
 * than defaulted to stdin, because a command typed by hand that silently waits on a terminal looks
 * exactly like one that has hung.
 */
const fragment = (from: string): string => fs.readFileSync(from === "-" ? 0 : path.resolve(from), "utf8");

/** Whichever description is in force — the one every one of these verbs writes to. */
const describing = (): string => Workspace.find({ config: configFile }).configFile;

/**
 * The description: where it comes from, and how it changes.
 *
 * Registered before anything is loaded, because all of these are what you reach for when there is no
 * description yet, when the one being read is not the one you meant, or when the one you have will
 * not load — which is the moment a writer is worth most and a loaded System is impossible.
 */
const config: Parameters<Cli["command"]>[1] = {
  summary: "the description this tool reads, where it comes from, and how it changes",
  verbs: {
    template: {
      summary: "print a config file with every field witness understands, and its documentation",
      raw: true,
      run: () => Template.forWitness().render(),
    },
    explore: {
      summary: "[<service>] [--as=<action to run first>] [--pages=N] [--depth=N] — walk the running app and print the description it implies",
      // The fragment IS the answer, so it is not wrapped in a record of a request nobody made.
      raw: true,
      // Unlike its siblings this one needs the description loaded — an origin to walk, the identities
      // to carry, the routes it already declares. It is listed before that happens and only ever RUN
      // after, which is why the variable is enough and a second registration was not.
      run: async (args: string[], flags: string[] = []) => {
        // The action to run before the walk: a sign-in, an upload, a seed — whatever leaves the app in
        // the state worth describing, named as the action that already describes it. Without one a
        // crawl of anything behind a gate describes the gate and stops. Read first, because a flag
        // typed with a space is a usage error and nothing below it is worth doing.
        const as = Cli.flag(flags, "as");
        const service = args[0] ?? Explore.likelyApp(system.config);
        const number = (flag: string, fallback: number): number =>
          Number(flags.find(f => f.startsWith(`--${flag}`))?.split("=")[1] ?? fallback);
        const found = await Explore.of(system, service, { maxPages: number("pages", 12), maxDepth: number("depth", 2), as });
        return Explore.render(found, service, as);
      },
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
    merge: {
      summary: "<file|-> — apply a fragment (the one `explore` prints) to the description, keeping its comments",
      // What it prints is a sentence about what it did, not a record of a request nobody made.
      raw: true,
      run: (args: string[]) => Author.merge(describing(), fragment(Cli.need(args[0], "file, or - for stdin"))).summary,
    },
    set: {
      summary: "<field> <value> — one field, addressed the way `config template` documents it",
      raw: true,
      run: (args: string[]) => Author.set(describing(), Cli.need(args[0], "field"), Cli.need(args[1], "value")).summary,
    },
  },
};

/**
 * `witness action add` / `action rm`: the half of the actions noun that writes.
 *
 * Registered here rather than beside `list`, `show` and `run` for two reasons. It validates a step
 * list against the type the engine dispatches on, which means reading witness's own sources through
 * `import.meta` — a thing nothing reachable from `src/index.ts` may do. And the noun those three live
 * under is only registered once a description already declares an action, which is precisely the
 * state the first `add` is meant to get you out of.
 */
const action: Parameters<Cli["command"]>[1] = {
  summary: "the actions this description declares — write one, drop one, or drive them",
  verbs: {
    add: {
      summary: "<name> --from=<file|-> — a step list, validated, placed under its service",
      raw: true,
      run: (args: string[], flags: string[] = []) => {
        const from = Cli.flag(flags, "from");
        // Refused rather than defaulted to stdin: `action add checkout` on its own would sit waiting
        // on a terminal, which reads as the tool having hung on the one verb people try first.
        if (!from) Cli.die("missing --from=<file|-> — the action to add, as JSONC, or `-` to read it from a pipe", 2);
        return Author.addAction(describing(), Cli.need(args[0], "action"), fragment(from)).summary;
      },
    },
    rm: {
      summary: "<name> — drop it, and the note written above it",
      raw: true,
      run: (args: string[]) => Author.removeAction(describing(), Cli.need(args[0], "action")).summary,
    },
  },
};

/**
 * `witness skill`: how to use this, generated from what this copy can actually do.
 *
 * Its own command rather than a verb under `config`, because it is not about the description — and it
 * has to answer before there is one, which is the moment somebody most needs it.
 */
const skill: Parameters<Cli["command"]>[1] = {
  summary: "how to use this, generated from what this copy can do — `--write` rewrites the copy on disk",
  passthrough: (args: string[]) => {
    const text = describe();
    if (!args.includes("--write")) {
      process.stdout.write(`${text}\n`);
      return;
    }
    // `init` wrote this file once and nothing ever rewrote it: `Workspace.create` skips what already
    // exists, so the copy an agent reads was true on the day the directory was made and has been
    // drifting since. The whole argument for generating it is that wrong instructions are worse than
    // none, and a stale snapshot is wrong instructions with a disclaimer on top.
    const at = path.join(Workspace.find({ config: configFile }).dir, "SKILL.md");
    fs.writeFileSync(at, `${text}\n`);
    process.stdout.write(`wrote ${path.relative(process.cwd(), at)}\n`);
  },
};

/** With a description, the instructions name that product's own apps, actions, operations and queries. */
function describe(opts: { quiet?: boolean } = {}): string {
  try {
    return Skill.for({ system: System.fromConfig(Workspace.find({ config: configFile }).configFile), extra: extras }).render();
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
    return Skill.for({ extra: extras }).render();
  }
}

/** `witness init`: the directory, and a description generated from the types this copy understands. */
const init: Parameters<Cli["command"]>[1] = {
  summary: `make a ${Workspace.DIRECTORY}/ in this directory`,
  passthrough: (args: string[]) => {
    const root = args.find(a => !a.startsWith("--")) ?? process.cwd();
    // The stack is already described, in the compose file next to this. Handing somebody a blank
    // template to retype it into is asking them to be wrong later — and it is the first thing every
    // description gets wrong, because nothing checks a port until something cannot reach it.
    const fromCompose = Compose.read(root);
    const { workspace, written } = Workspace.create(root, {
      "config.jsonc": fromCompose
        ? Compose.render(path.basename(path.resolve(root)), fromCompose)
        : Template.forWitness().render(),
      // How to use this, generated from what this copy can actually do — so an agent that opens the
      // directory finds instructions rather than having to infer the tool from its own source.
      "SKILL.md": describe({ quiet: true }),
      // Everything a run leaves behind lands here, and none of it belongs in a commit. Kept beside the
      // output rather than in the project's own .gitignore: this directory brings its own rules with it.
      ".gitignore": "# What runs leave behind. The description beside it is worth committing; this is not.\nartifacts/\n",
    });
    process.stdout.write(
      written.length
        ? `${written.map(f => `wrote ${path.relative(process.cwd(), f)}`).join("\n")}\n` +
            (fromCompose
              ? `\nRead ${Object.keys(fromCompose.services).length} service(s) off ${path.basename(Compose.fileIn(root) ?? "compose")}. Next:\n` +
                `  witness stack status\n  witness config explore\n`
              : `\nEdit ${path.relative(process.cwd(), workspace.configFile)} down to what your product has, then:\n` +
                `  witness stack status\n  witness action list\n`)
        : `${path.relative(process.cwd(), workspace.dir)}/ already has everything — nothing written\n`,
    );
  },
};

/**
 * What the entry point adds on top of what a description generates, named ONCE.
 *
 * The command line registered these and the skill generator did not, because `describe()` built a
 * second, fresh System of its own — so the instructions handed to an agent described this CLI minus
 * `config`, `init` and `skill`. One object, both callers, and the two cannot drift apart again.
 */
const extras = { action, config, init, skill };

if (rest[0] === "init") {
  init.passthrough!(rest.slice(1));
  process.exit(0);
}

// Before a description exists is exactly when the instructions are worth having.
if (rest[0] === "skill") {
  skill.passthrough!(rest.slice(1));
  process.exit(0);
}

/**
 * The `config` verbs that answer without a System behind them.
 *
 * `template` describes a product before there is a description to load, and `where` has to answer
 * when what it would load is missing or broken — which is when it is asked. `merge` and `set` are
 * here for the stronger version of the same reason: a description that will not load is exactly the
 * one somebody needs to change, and a writer that first insists on assembling a browser, a stack and
 * an API client out of the file it is being asked to repair is a writer that refuses when it matters.
 *
 * Not `explore`, which needs the description — an origin to walk, the identities to carry, the routes
 * it already declares — so it falls through to the system-backed command line below.
 */
const withoutASystem = new Set(["template", "where", "merge", "set"]);

if (rest[0] === "config") {
  const name = rest[1] ?? "";
  if (!configFile) {
    // A noun with no verb is a question, not a mistake — this branch used to refuse every verb it did
    // not personally own, including the empty one, so `witness config` answered `unknown: config`
    // about a noun its own help documents.
    const listed = Cli.listVerbs("config", config, rest[1]);
    if (listed) {
      process.stdout.write(listed);
      process.exit(0);
    }
    // A verb that does not exist is still a clean 2 here. Falling through for ANYTHING unrecognised
    // sent `config nonsense` on to load a description it never needed, and the reader got "no
    // .witness/ directory" instead of being told the verb was the problem.
    if (!config.verbs![name]) Cli.die(`unknown: config ${name}`.trim(), 2);
  }
  if (withoutASystem.has(name)) {
    // Split the way `Cli.run` splits it, so a verb behaves the same however it was reached.
    const given = rest.slice(2);
    try {
      const answer = config.verbs![name].run(
        given.filter(argument => !argument.startsWith("--")),
        given.filter(argument => argument.startsWith("--")),
      );
      process.stdout.write(typeof answer === "string" ? `${answer}\n` : `${JSON.stringify(answer, null, 2)}\n`);
    } catch (err) {
      // What `Cli.main` does for every other verb. Without it these four printed a Node stack trace
      // over a refusal whose whole job is to say, in one sentence, what was wrong with the input.
      Cli.die(err instanceof Error ? err.message : String(err));
    }
    process.exit(0);
  }
}

let system: System;
try {
  system = configFile ? System.fromConfig(configFile) : System.find();
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}

Cli.main(system.addCommands(extras).cli(), rest);
