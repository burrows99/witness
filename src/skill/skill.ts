import * as path from "node:path";

import { Cli } from "../cli/cli.ts";
import { slug } from "../evidence/paths.ts";
import { Stack } from "../environment/stack.ts";
import { Template } from "../config/template.ts";
import { TypeSource, type TypeField } from "../config/types.ts";

/**
 * The instructions this tool hands whoever is driving it.
 *
 * Written for an agent, and generated for the same reason the config template is: a page of prose
 * about what a tool can do is wrong the week after it is written, and wrong instructions are worse
 * than none — they send someone to a verb that no longer exists and the failure looks like the tool.
 *
 * So every list here is asked for at the moment it is printed: the commands from the command line
 * itself, the step verbs from the type an action's steps are, the config's fields from the type that
 * reads them, the providers from the registries. Add a verb and the next `witness skill` documents it,
 * with nobody remembering anything.
 *
 * What it cannot generate is the shape of the work — when to reach for a command and when to write a
 * spec — so that part is prose, and it is the part worth reading.
 */
export class Skill {
  private readonly name: string;
  private readonly commands: { noun: string; summary: string; verbs: { verb: string; summary: string }[] }[];
  private readonly types: TypeSource;
  private readonly providers: Map<string, string[]>;
  /** Where this file belongs for THIS project — which is not `.witness/` for a project that has none. */
  private readonly at: string;
  /** Named parts of the product, when a config was given: what THIS system can be asked to do. */
  private readonly product?: {
    apps: string[];
    actions: { name: string; summary?: string }[];
    queries: string[];
    operations: string[];
    secrets: string[];
    cast: string[];
  };

  constructor(opts: {
    name?: string;
    commands: Skill["commands"];
    types: TypeSource;
    providers?: Map<string, string[]>;
    product?: Skill["product"];
    /** Where this file lives, for the line that tells the reader to rewrite it. */
    at?: string;
  }) {
    this.name = opts.name ?? "witness";
    this.at = opts.at ?? ".witness/SKILL.md";
    this.commands = opts.commands;
    this.types = opts.types;
    this.providers = opts.providers ?? new Map();
    this.product = opts.product;
  }

  /**
   * The instructions for a described product, or the generic ones when there is no description yet.
   *
   * `init` writes the generic version, because it runs at the moment the config is created and the
   * config it just wrote is a template with placeholders in it. Run `witness skill` afterwards and the
   * product's own apps, actions and verbs are in it.
   */
  static for(opts: { system?: SystemLike; sourceDir?: string } = {}): Skill {
    const types = TypeSource.fromDirectory(opts.sourceDir ?? Template.sourceDir());
    const system = opts.system;
    if (!system) {
      // A real stack over no services: enough to register the built-in nouns and ask them their names.
      const stack = new Stack({ root: process.cwd(), services: {} });
      const cli = new Cli({ name: "witness", stack }).withDefaults({
        test: { command: "", args: [] },
        api: async () => ({}),
        sql: () => "",
        renderVideos: () => [],
      });
      return new Skill({ commands: cli.commands, types, providers: Template.providers() });
    }
    return new Skill({
      name: system.config.name,
      at: system.workspace ? path.join(path.relative(process.cwd(), system.workspace.dir) || ".", "SKILL.md") : undefined,
      commands: system.cli().commands,
      types,
      providers: Template.providers(),
      product: {
        apps: Object.keys(system.config.apps ?? {}),
        actions: Object.entries(system.config.actions ?? {}).map(([name, action]) => ({ name, summary: action.summary })),
        queries: Object.keys(system.config.database?.queries ?? {}),
        operations: Object.keys(system.config.api?.operations ?? {}),
        secrets: Object.keys(system.config.secrets ?? {}),
        cast: Object.keys(system.config.cast ?? {}),
      },
    });
  }

  render(): string {
    // What the command line is CALLED and what a skill may be NAMED are two different things: a project
    // whose config says `npm run acme --` — so that its help text reads correctly — cannot carry that as
    // a name. Examples use the invocation; the name is slugged from it.
    const tool = this.name;
    return [
      "---",
      `name: ${slug(this.name, 48) || "witness"}`,
      "description: >-",
      `  Drive this project's running app and come back with evidence — the requests with their bodies, a`,
      `  frame per step, a video, and a written-up debug story. Use for "show me it works", "record a`,
      `  before/after", "why is X not showing", or any change whose proof is something a person watches.`,
      "---",
      "",
      `# ${tool}`,
      "",
      `Generated by \`${tool} skill\`, which asks the tool itself for every list below.`,
      "",
      "**This file is a snapshot.** It was true when it was written, and the config and the tool have both",
      "moved on if anyone has touched them since. Three commands settle any question it raises — they are",
      "the source it was generated from:",
      "",
      "```bash",
      ...Skill.aligned([
        [`${tool} --help`, "every command this project actually has"],
        [`${tool} action list`, "every action, with what it is for"],
        [`${tool} skill > ${this.at}`, "rewrite this file from what is true now"],
      ]),
      "```",
      "",
      ...this.intuition(),
      ...this.loop(),
      ...this.commandSection(),
      ...this.productSection(),
      ...this.actionSection(),
      ...this.specSection(),
      ...this.evidenceSection(),
      ...this.configSection(),
      ...this.rules(),
    ].join("\n");
  }

  /** The part that cannot be generated, and the part worth reading. */
  private intuition(): string[] {
    return [
      "## Running it",
      "",
      "It is a dependency, not something on your PATH:",
      "",
      "```bash",
      "npx witness <command>       # or: pnpm exec witness, ./node_modules/.bin/witness",
      "```",
      "",
      `This project's help calls it \`${this.name}\` — that is the name in its usage line, not a command you`,
      "can type. The examples below are written the short way.",
      "",
      "## The shape of it",
      "",
      "Two surfaces, and knowing which one you are on saves most of the time this tool can save.",
      "",
      "**The command line is for state.** Setting it up, reading it back, and finding out whether the",
      "thing is even running. Every command reports the whole exchange — the request, the response, the",
      "statement, the timing — because the caller usually cannot open a network tab. Reach for it first:",
      "most questions (\"why is this empty\", \"did that save\") are answered in one command, and writing a",
      "test to answer them is how an afternoon disappears.",
      "",
      "**A spec is for behaviour.** A sequence someone performs, with assertions, branching and narration.",
      "That is a program, so it lives in a file — `.witness/specs/*.spec.ts`.",
      "",
      "**A declared action needs no file at all.** It is data, so it can just be run:",
      `\`${this.name} action run <name> [key=value…]\` drives it in a browser and comes back with the`,
      "frames, the debug story and the video. Chain several and they share one browser, one recording,",
      "and whatever each one stored. Reach for a spec when there is a decision or an assertion to make.",
      "",
      "**The description is data, and it is the point.** Routes, requests, queries, sign-in flows and",
      "actions are declared in `.witness/config.jsonc`, not written as code. Anything you would otherwise",
      "hand-write twice belongs there; anything with a decision in it belongs in a spec.",
      "",
    ];
  }

  private loop(): string[] {
    const has = (noun: string): boolean => this.commands.some(c => c.noun === noun);
    const tool = this.name;
    return [
      "## The loop",
      "",
      "```bash",
      ...Skill.aligned([
        [`${tool} stack status`, "is it up, and is what is answering ours"],
        ...(has("api") ? [[`${tool} api get /v1/whatever`, "read the real payload before theorising about it"] as const] : []),
        ...(has("db") ? [[`${tool} db sql "select …"`, "what was actually stored"] as const] : []),
        [`${tool} test --before`, "record the behaviour as it is now"],
        ["#   … make the change …", ""],
        [`${tool} test --after`, "record it again, filed beside the first"],
      ]),
      "```",
      "",
      "Then read `.witness/artifacts/<spec>/<test>/<cut>/actions/<action>/debug.md`: what was attempted,",
      "what the network did during each step, what the console said, and — if something failed — the step",
      "it failed on with the frame from that moment. That file exists so nobody has to re-run anything",
      "with more logging.",
      "",
    ];
  }

  private commandSection(): string[] {
    const lines = ["## Commands", ""];
    for (const command of this.commands) {
      lines.push(`- \`${this.name} ${command.noun}\` — ${command.summary}`);
      for (const verb of command.verbs) lines.push(`  - \`${command.noun} ${verb.verb}\` — ${verb.summary}`);
    }
    lines.push(
      "",
      "Add `--quiet` for the bare answer. Exit codes: `0` it worked · `1` it ran and failed · `2` you",
      "asked for something that does not exist.",
      "",
    );
    return lines;
  }

  /** What THIS product declares, when the instructions were generated against one. */
  private productSection(): string[] {
    if (!this.product) {
      return [
        "## This project",
        "",
        "The config is a template until you cut it down to what your product has. Once it describes",
        `something, run \`${this.name} skill\` again and this section lists that product's own apps, actions,`,
        "operations and queries.",
        "",
      ];
    }
    const { apps, actions, operations, queries } = this.product;
    const lines = ["## This project", ""];
    if (apps.length) lines.push(`- **apps**: ${apps.map(a => `\`${a}\``).join(", ")} — routes open as \`app.<name>.<route>.open(page)\``);
    if (actions.length) {
      lines.push("- **actions**:");
      for (const action of actions) lines.push(`  - \`${action.name}\`${action.summary ? ` — ${action.summary}` : ""}`);
    }
    if (operations.length) lines.push(`- **operations**: ${operations.slice(0, 20).map(o => `\`${o}\``).join(", ")}${operations.length > 20 ? ` …and ${operations.length - 20} more` : ""}`);
    if (queries.length) lines.push(`- **queries**: ${queries.slice(0, 20).map(q => `\`${q}\``).join(", ")}${queries.length > 20 ? ` …and ${queries.length - 20} more` : ""}`);
    if (this.product.cast.length) lines.push(`- **cast**: ${this.product.cast.map(c => `\`${c}\``).join(", ")} — \`app.cast("name")\``);
    if (this.product.secrets.length) {
      // A signed-in run needs these before it needs anything else, and they were findable only by
      // reading the config.
      lines.push(
        `- **secrets it will ask for**: ${this.product.secrets.map(s => `\`${s}\``).join(", ")}` +
          " — `app.secret(\"name\")`; the config says where each comes from",
      );
    }
    lines.push("", `\`${this.name} action show <name>\` prints the steps of any of them, as declared.`, "");
    return lines;
  }

  /** Every verb a step can use, from the type the engine reads. */
  private actionSection(): string[] {
    const step = this.types.declaration("StepConfig");
    if (step.kind !== "object") return [];
    const lines = [
      "## Writing an action",
      "",
      "An action is a sequence of steps in the config — data, not code — and every one of them returns",
      "its own evidence. These are the verbs a step can use:",
      "",
    ];
    for (const field of step.fields as TypeField[]) {
      if (field.name === "note" || field.name === "as") continue;
      lines.push(`- \`${field.name}\`${field.doc ? ` — ${Skill.sentence(field.doc)}` : ""}`);
    }
    lines.push(
      "",
      "`{placeholders}` are filled from the action's inputs and from anything an earlier step stored, so",
      "a value read off the screen or out of a response is available to every step after it.",
      "",
    );
    return lines;
  }

  /** The half a config cannot express — and the half that was documented nowhere. */
  private specSection(): string[] {
    return [
      "## Writing a spec",
      "",
      "A spec is for a decision, an assertion or narration. Everything it needs is on the system your",
      "`app.ts` exports:",
      "",
      "```ts",
      'import { expect } from "@playwright/test";',
      'import { caption, slide, testFor } from "@burrows99/witness";',
      "",
      'import { app } from "../app.ts";           // `export const app = System.find()`',
      "",
      "const test = testFor(app);                  // the config's identities, already in the browser",
      'const member = app.cast<{ email: string }>("memberA");',
      "",
      'test("what the claim is", async ({ page }) => {',
      "  const evidence = app.evidence();",
      "",
      '  await slide(page, "What this shows", ["one line per point"]);',
      '  const run = await app.run("app.signIn", page, { email: member.email, password: app.secret("memberAPassword") });',
      "  expect(run.ok).toBe(true);",
      "",
      '  await caption(page, "About to do the thing", "why it matters");',
      '  await app.run("app.doTheThing", page, { id: "…" });',
      '  await evidence.frame(page, "what it looks like now");',
      "",
      "  // Assert at the layer the claim is about: the screen, the API, or what was stored.",
      '  const stored = app.db.query("thing.byId", { id: "…" });',
      "",
      "  await evidence.manualVerification({",
      '    title: "What this shows",',
      "    subject: { account: member.email, stored },",
      '    notes: ["how a person re-walks this by hand"],',
      "  });",
      "});",
      "```",
      "",
      "- `app.run(action, page, inputs)` returns everything it did, and throws with that attached when a",
      "  step fails. `app.db.query`, `app.api.call`, `app.secret`, `app.cast` are the rest of the surface.",
      "- **An assertion passing is not the same as evidence.** A `css` or `testId` match can succeed on a",
      "  node that is off-screen — the run goes green and the picture shows nothing. Assert on what is",
      "  visible, and open the frame before you believe your own caption.",
      "- `{placeholders}` substitute inside locator specs too, not only in values.",
      "- `waitForUrl` takes a **regular expression** — a bare substring is the commonest useful form, and",
      "  a glob (`**/products/**`) is a syntax error, not a pattern.",
      "- `store` reads ONE element; `store: { …, \"all\": true }` reads every match as an array.",
      "- When a run fails, the LAST line it prints is where the story is — that is the reporter in",
      "  `playwright.config.ts` (`[\"@burrows99/witness/reporter\"]`), which exists because a runner's own",
      "  output buries it under a wall of attachment paths.",
      `- Everything after \`test\` goes to the runner: \`${this.name} test chat-persists\` runs one spec,`,
      "  `--headed` watches it, `KEEP=1` tells a spec that cleans up to leave its data alone.",
      "",
    ];
  }

  private evidenceSection(): string[] {
    return [
      "## What a run leaves behind",
      "",
      "```",
      ".witness/artifacts/<spec>/<test>/<cut>/",
      "  video.mp4                          the recording",
      "  frames/01-….png                    stills, in the order they were taken",
      "  actions/<action>/01-….png          a frame per step",
      "  actions/<action>/debug.md|.json    what happened, with every request and log tied to its step",
      "  manual-verification.md             how to re-walk it by hand",
      "```",
      "",
      `\`<cut>\` is \`before\`, \`after\` or \`run\` — \`EVIDENCE=before ${this.name} test\`, or \`${this.name} test --before\`.`,
      "The two halves sit side by side and a re-run overwrites rather than accumulates. Nothing is named",
      "by hand: the path comes from the spec, the test and the cut.",
      "",
    ];
  }

  private configSection(): string[] {
    const config = this.types.declaration("SystemConfig");
    const lines = ["## The description", "", "`.witness/config.jsonc` — comments allowed. Its fields:", ""];
    if (config.kind === "object") {
      for (const field of config.fields as TypeField[]) {
        lines.push(`- \`${field.name}\`${field.optional ? "" : " (required)"}${field.doc ? ` — ${Skill.sentence(field.doc)}` : ""}`);
      }
    }
    lines.push("", `\`${this.name} config template\` prints every field with its full documentation.`, "");
    if (this.providers.size) {
      lines.push("Anything that meets the outside world is a provider picked by name:", "");
      for (const [kind, names] of this.providers) lines.push(`- **${kind}**: ${names.map(n => `\`${n}\``).join(", ")}`);
      lines.push("");
    }
    return lines;
  }

  private rules(): string[] {
    return [
      "## Rules of thumb",
      "",
      "- **Drive the real app.** Set the world up through its own API or UI. A row written by hand is a",
      "  row the app never agreed to, and a test built on one passes for the wrong reason.",
      "- **Assert at the right layer.** The screen is evidence of what rendered, the API of what it",
      "  answered, the database of what was stored. Pick the one the claim is about.",
      "- **Read the payload before theorising.** One `api get` beats an afternoon of inference from",
      "  screenshots.",
      "- **Narrate.** A recording nobody can follow is not evidence: caption before each action.",
      "- **Leave the note.** `evidence.manualVerification()` turns \"it passed\" into something a reviewer",
      "  can check themselves.",
      "",
    ];
  }

  /** Commands in one column and what they are for in another, however long the commands are. */
  private static aligned(rows: readonly (readonly [string, string])[]): string[] {
    const width = Math.max(...rows.map(([command]) => command.length));
    return rows.map(([command, why]) => (why ? `${command.padEnd(width)}  # ${why}` : command));
  }

  private static sentence(doc: string): string {
    const first = doc.split(/(?<=\.)\s/)[0];
    return first.length > 160 ? `${first.slice(0, 160)}…` : first;
  }
}

/** Just enough of a system to describe it, so this file does not depend on the composite root. */
type SystemLike = {
  workspace?: { dir: string };
  config: {
    name: string;
    apps?: Record<string, unknown>;
    actions?: Record<string, { summary?: string }>;
    database?: { queries?: Record<string, string> };
    api?: { operations?: Record<string, unknown> };
    secrets?: Record<string, unknown>;
    cast?: Record<string, unknown>;
  };
  cli: () => Cli;
};
