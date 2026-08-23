import * as path from "node:path";

import { Cli } from "../cli/cli.ts";
import { slug } from "../evidence/paths.ts";
import { Stack } from "../environment/stack.ts";
import { Template } from "../config/template.ts";
import { TypeSource } from "../config/types.ts";

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
 * description — so that part is prose, and it is the part worth reading.
 */
export class Skill {
  private readonly name: string;
  private readonly commands: { noun: string; summary: string; verbs: { verb: string; summary: string }[] }[];
  private readonly types: TypeSource;
  private readonly providers: Map<string, string[]>;
  /** What a reader has to type — not what the tool calls itself. */
  private readonly run: string;
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
    /** What a reader types to run it. Defaults to whatever npm says about how this was invoked. */
    run?: string;
  }) {
    this.name = opts.name ?? "witness";
    this.run = opts.run ?? Skill.invocation();
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
  /**
   * How this project actually runs the tool.
   *
   * `npx witness` is right for a dependency and wrong for a vendored checkout, and a config's `name` is
   * what its own help prints — often not a command at all (`npm run hesta --`, `aix`). npm answers it
   * outright: a package script sets `npm_lifecycle_event` to its own name, so an invocation through one
   * is `npm run <that> --`, which is exactly what the reader has to type.
   */
  static invocation(env: Record<string, string | undefined> = process.env): string {
    const script = env.npm_lifecycle_event;
    // `npm test` and `npm start` take no `--`, and neither is how this gets driven.
    // `npx` is npm's own launcher and sets this too, which made `npx witness skill` generate a file
    // telling its reader to type `npm run npx --`.
    return script && !["test", "start", "install", "prepare", "npx", "exec"].includes(script) ? `npm run ${script} --` : "npx witness";
  }

  static for(opts: { system?: SystemLike; sourceDir?: string } = {}): Skill {
    const types = TypeSource.fromDirectory(opts.sourceDir ?? Template.sourceDir());
    const system = opts.system;
    if (!system) {
      // A real stack over no services: enough to register the built-in nouns and ask them their names.
      const stack = new Stack({ root: process.cwd(), services: {} });
      const cli = new Cli({ name: "witness", stack }).withDefaults({
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
    // Three different things, and conflating any two of them misleads: what the tool is CALLED in its
    // own help (`this.name`), what a skill may be NAMED (a slug), and what a reader has to TYPE.
    const tool = this.run;
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
      ...this.describingSection(),
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
      `In this project: \`${this.run} <command>\` — which is how it was run to generate this file.`,
      "",
      `Its own help calls it \`${this.name}\`; that is the usage line, not necessarily something you can`,
      "type. Every example below is written the way that works here.",
      "",
      "## The shape of it",
      "",
      "Two surfaces, and knowing which one you are on saves most of the time this tool can save.",
      "",
      "**The command line is for state.** Setting it up, reading it back, and finding out whether the",
      "thing is even running. Every command reports the whole exchange — the request, the response, the",
      "statement, the timing — because the caller usually cannot open a network tab. Reach for it first:",
      "most questions (\"why is this empty\", \"did that save\") are answered in one command.",
      "",
      "**An action is for behaviour.** A sequence someone performs, with its narration and its claims —",
      `declared in the config and run outright: \`${this.run} action run <name> [key=value…]\` drives it`,
      "in a browser and comes back with the frames, the debug story and the video. Chain several and they",
      "share one browser, one recording, and whatever each one stored — and each invocation is a FRESH,",
      "signed-out browser, so an action that needs somebody signed in must run the one that signs in,",
      "in the same invocation (`… run signIn checkout`, or a `run` step inside it).",
      "",
      `\`--parallel\` drives every action you name AT ONCE, each in its own browser, and stitches the`,
      "recordings into panels of one video — which is the whole reason to run them together. They",
      "cannot pass values to each other, and each lane is its own fresh signed-out browser, so anything",
      "needing a session must sign itself in (`run: signIn` as its first step). `--retries=N` gives a",
      "failing action more goes in a fresh browser, and keeps the failed attempt's evidence beside the",
      "one that worked — the failure is the interesting one.",
      "",
      "**A service owns what is true about it.** Its credentials, its API, its screens and its actions",
      "are written under it in `services`, once — an action there needs no `app` and no `<service>.`",
      "in its own name, and reaches its siblings and its service's secrets by bare name. The top level",
      "carries only what is SHARED or about more than one service.",
      "",
      "There is no third thing. **There are no test files to write**: an action composes other actions",
      "(`run`), narrates (`caption`, `slide`), asserts against the screen (`expect`) and against what the",
      "API answered or the database stored (`check`). Anything you would otherwise write as a program",
      "belongs in `.witness/config.jsonc` as steps — that is the whole idea, and it is why a description",
      "of a product is worth more than a suite about it.",
      "",
    ];
  }

  private loop(): string[] {
    const has = (noun: string): boolean => this.commands.some(c => c.noun === noun);
    // `this.name` is what the tool's own help calls itself and is often not typeable (`npm run acme --`
    // is, `grafana` is not). Every example is what a reader has to type — which is the whole reason
    // these are two different things.
    const tool = this.run;
    return [
      "## The loop",
      "",
      "```bash",
      ...Skill.aligned([
        [`${tool} stack status`, "is it up, and is what is answering ours"],
        ...(has("api") ? [[`${tool} api get /v1/whatever`, "read the real payload before theorising about it"] as const] : []),
        ...(has("db") ? [[`${tool} db sql "select …"`, "what was actually stored"] as const] : []),
        [`EVIDENCE=before ${tool} action run <name>`, "record the behaviour as it is now"],
        ["#   … make the change …", ""],
        [`EVIDENCE=after ${tool} action run <name>`, "record it again, filed beside the first"],
      ]),
      "```",
      "",
      "Then read `.witness/artifacts/cli/<chain>/<cut>/actions/<action>/debug.md`: what was attempted,",
      "what the network did during each step, what the console said, and — if something failed — the step",
      "it failed on with the frame from that moment. That file exists so nobody has to re-run anything",
      "with more logging.",
      "",
    ];
  }

  private commandSection(): string[] {
    const lines = ["## Commands", ""];
    for (const command of this.commands) {
      lines.push(`- \`${this.run} ${command.noun}\` — ${command.summary}`);
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
        `something, run \`${this.run} skill\` again and this section lists that product's own apps, actions,`,
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
    lines.push("", `\`${this.run} action show <name>\` prints the steps of any of them, as declared.`, "");
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
    for (const field of step.fields) {
      if (field.name === "note" || field.name === "as") continue;
      lines.push(`- \`${field.name}\`${field.doc ? ` — ${Skill.sentence(field.doc)}` : ""}`);
    }
    lines.push(
      "",
      "`{placeholders}` are filled from the action's inputs and from anything an earlier step stored, so",
      "a value read off the screen or out of a response is available to every step after it. A dotted",
      "name reaches inside it: `{stats.dashboards}` after an `api` step kept the answer, `{rows.length}`",
      "for how many things a `store` gathered.",
      "",
      "Things that cost other people an afternoon:",
      "",
      "- **Say a thing once.** Inside a service, `{ \"containerEnv\": \"KEY\" }` means THAT service's",
      "  container — naming the service again is what being written there already says. An `auth` block",
      "  points at a credential the `secrets` block declares with `{ \"secret\": \"name\" }` rather than",
      "  respelling where it comes from, which is two places to change and one to forget.",
      "- **Wait for a route, not a URL.** `{ \"waitForUrl\": { \"route\": \"home\" } }` resolves through the",
      "  service's declared port; a literal `localhost:3020` in a step disconnects `portVar` quietly.",
      "- **An assertion passing is not the same as evidence.** A `css` or `testId` match can succeed on",
      "  a node that is off-screen — the run goes green and the picture shows nothing. Assert on what is",
      "  visible, and open the frame before you believe your own caption.",
      "- `{placeholders}` substitute inside locators too, not only in values.",
      "- `waitForUrl` takes a **regular expression** — a bare substring is the commonest useful form, and",
      "  a glob (`**/products/**`) is a syntax error, not a pattern.",
      "- `store` reads ONE element; `store: { …, \"all\": true }` reads every match as an array.",
      "- `expect` is about the screen and `check` is about the values — comparing what the API said to",
      "  what the page shows is a `check`, and it is the whole reason an action needs no program.",
      "- An action that takes inputs is composed with `run: { \"action\": …, \"with\": { … } }`; the bare",
      "  string form passes on whatever the caller already had.",
      "",
    );
    return lines;
  }

  /**
   * How a description comes to exist.
   *
   * The generated half of this file says what the vocabulary IS. Nothing generated can say where the
   * words come from, and that is the question anyone opening an undescribed product asks first — so
   * this is prose, and it is a practice rather than a command.
   */
  private describingSection(): string[] {
    const tool = this.run;
    return [
      "## Describing what you ship",
      "",
      "A description is not written in one sitting and it is not reverse-engineered from a finished",
      "product. It is built by whoever is shipping, one change at a time: **if your change touches a",
      "screen, the same change describes it** — the route it added, the locator it needs, the action a",
      "person now performs. A description written this way is never out of date, because it was never",
      "written separately from the thing it describes.",
      "",
      "The part that needs a person (or an agent) is the part a machine cannot be right about: which",
      "flows matter, what to call them, and what is worth claiming about them. The part that does NOT",
      "need judgment is what a screen actually renders — and that is not read out of the app's source.",
      "It is read out of a run:",
      "",
      "```bash",
      ...Skill.aligned([
        [`${tool} action list`, "what is already described — reuse before adding"],
        ["#   … write the action for what you changed …", ""],
        [`${tool} action run <yours>`, "it will fail on a locator; that is the point"],
        ["#   … open the frame the story names, fix it, run again …", ""],
        [`EVIDENCE=before ${tool} action run <yours>`, "then make the change, then EVIDENCE=after"],
      ]),
      "```",
      "",
      `And when a run breaks that used to pass, ask \`${tool} check drift <the action that signs in>\``,
      "before rewriting anything: it re-checks every claim the description makes — each locator against",
      "the route the step using it is on — and names ALL of them at once. A run tells you about the",
      "first one, thirty seconds later, and buys you the next one only after you fix it.",
      "",
      "And do not hand-write a locator you could be handed. `npx playwright codegen <url>` records what",
      "you do and prints the locator for each step, choosing them the same way this tool resolves them —",
      "role and accessible name first, a CSS selector last. Its **Pick Locator** button gives you one for",
      "anything you hover. For a screen behind a login, `--save-storage` once and `--load-storage` after",
      "means you record the screen you actually care about instead of the sign-in in front of it.",
      "",
      "**A locator you have not run is a guess.** In this tool's own worked example, five of nine",
      "actions named something that did not exist on the page — a button that looked like a link, a",
      "placeholder with different words, a test id with the item's name appended, a table whose header",
      "is a row like any other. Not one of those was visible in the app's source; every one was in the",
      "frame from the step that failed. Write the step, run it, read the frame, fix it — before the",
      "change ships, not after somebody else's run breaks on it.",
      "",
    ];
  }

  private evidenceSection(): string[] {
    return [
      "## What a run leaves behind",
      "",
      "```",
      ".witness/artifacts/cli/<the actions you ran>/<cut>/",
      "  video.mp4                          the recording",
      "  frames/01-….png                    stills, in the order they were taken",
      "  actions/<action>/01-….png          a frame per step",
      "  actions/<action>/debug.md|.json    what happened, with every request and log tied to its step",
      "  manual-verification.md             how to re-walk it by hand",
      "```",
      "",
      `\`<cut>\` is \`before\`, \`after\` or \`run\` — set it with \`EVIDENCE=before ${this.run} action run …\`.`,
      "The two halves sit side by side and a re-run overwrites rather than accumulates. Nothing is named",
      "by hand: the path comes from what was run and which cut it was.",
      "",
    ];
  }

  private configSection(): string[] {
    const config = this.types.declaration("SystemConfig");
    const lines = ["## The description", "", "`.witness/config.jsonc` — comments allowed. Its fields:", ""];
    if (config.kind === "object") {
      for (const field of config.fields) {
        lines.push(`- \`${field.name}\`${field.optional ? "" : " (required)"}${field.doc ? ` — ${Skill.sentence(field.doc)}` : ""}`);
      }
    }
    lines.push("", `\`${this.run} config template\` prints every field with its full documentation.`, "");
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
      "- **Describe it in the change that makes it.** A route, a locator or an action added a week",
      "  later is a week of runs that could not see it — and by then the frame that would have told",
      "  you what it is called is gone.",
      "- **Narrate.** A recording nobody can follow is not evidence: caption before each action.",
      "- **Leave the note.** An action's `verify` writes `manual-verification.md` — every value a",
      "  template, so it says what THIS run saw. It turns \"it passed\" into something a reviewer can",
      "  check themselves, and it is written whether the run passed or failed.",
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
