
import type { Stack } from "../environment/stack.ts";
import type { Trace } from "../diagnostics/trace.ts";

/**
 * A git-style command line over a system: `<tool> <noun> <verb> [args]`.
 *
 * Why a system needs one at all: everything it can do to the running app — sign someone in, move their
 * state on, ask the API a question, read a row — is useful OUTSIDE a test. Without a command line, an
 * agent (or a person) has to write a spec to do any of it, which is why so much poking at local stacks
 * ends up as throwaway curl and psql that nobody can rerun.
 *
 * The generic verbs are here (`stack status`, `api`, `db`, `video`); a project registers its own
 * vocabulary on top. Exit codes are the POSIX ones a caller can branch on:
 *   0 it worked · 1 it ran and failed · 2 you asked for something that does not exist.
 */
export class Cli {
  readonly name: string;

  private readonly nouns = new Map<string, Noun>();
  private readonly stack: Stack;
  private readonly trace?: Trace;

  constructor(opts: { name: string; stack: Stack; trace?: Trace }) {
    this.name = opts.name;
    this.stack = opts.stack;
    this.trace = opts.trace;
  }

  /** Register a noun and its verbs. Returns `this`, so registrations chain. */
  command(noun: string, spec: Noun): this {
    this.nouns.set(noun, spec);
    return this;
  }

  /** The generic half: where the stack is, and the escape hatches into it. */
  withDefaults(opts: {
    /** Rendering happens here, not in a subprocess. */
    renderVideos?: () => string[];
    api?: (method: string, path: string, body?: unknown) => Promise<unknown>;
    /** `on` names one of the extra databases the description declares; omitted means the default. */
    sql?: (query: string, on?: string) => string;
  }): this {
    this.command("stack", {
      summary: "what is up, on which ports, from which checkout",
      verbs: {
        status: {
          summary: "reachability of every service, and whether its container is up",
          run: async () => {
            const rows = await this.stack.status();
            const width = Math.max(...rows.map(r => r.name.length));
            return [
              `stack ${this.stack.suffix || "(primary)"} — resolved from ${this.stack.root}/.env`,
              ...rows.map(r => {
                // Three states, not two. `?` is "cannot tell" — nothing was asked, because there was
                // nothing to ask — and printing DOWN for it makes it indistinguishable from a service
                // that really is down, on the one board whose whole job is being believed.
                const state = r.answering ? "NOT OURS" : r.reachable === undefined ? "?" : r.reachable ? "up" : "DOWN";
                // A declared container that is not running, on a service that IS answering, means somebody
                // runs it on the host — normal. On one that is NOT answering it means exactly what it says.
                const where = r.answering
                  ? r.answering
                  : r.reachable === undefined
                    ? "judged by its container, and none is declared"
                    : r.containerUp
                      ? r.container
                      : r.container
                        ? r.reachable
                          ? "served from the host"
                          : `${r.container} is not running`
                        : "";
                return `  ${r.name.padEnd(width)}  ${r.url.padEnd(24)} ${state.padEnd(8)} ${where}`;
              }),
            ].join("\n");
          },
        },
      },
    });

    if (opts.api) {
      const call = opts.api;
      this.command("api", {
        summary: "any route on the API, authenticated the way a declared operation is",
        verbs: Object.fromEntries(
          ["get", "post", "patch", "delete"].map(method => [
            method,
            {
              summary: `${method.toUpperCase()} <path> [json]`,
              run: (args: string[]) => call(method.toUpperCase(), Cli.need(args[0], "path"), args[1] ? JSON.parse(args[1]) : undefined),
            },
          ]),
        ),
      });
    }

    if (opts.sql) {
      const sql = opts.sql;
      this.command("db", {
        summary: "the stack's databases",
        verbs: {
          sql: {
            // A stack with two of them is ordinary, so the second is named the way a second API is —
            // `--on`, not a second command.
            summary: "<query> [--on=<service>] — run it against the default database, or a named one",
            run: (args: string[], flags: string[] = []) => sql(Cli.need(args[0], "query"), Cli.flag(flags, "on")),
          },
        },
      });
    }

    if (opts.renderVideos) {
      const render = opts.renderVideos;
      this.command("video", {
        summary: "rebuild the MP4s from the last run's recordings",
        passthrough: () => {
          const written = render();
          process.stdout.write(`${written.length} video${written.length === 1 ? "" : "s"}\n`);
        },
      });
    }

    return this;
  }

  async run(argv: string[]): Promise<void> {
    const [noun, verb, ...rest] = argv;
    if (!noun || noun === "help" || noun === "-h" || noun === "--help") {
      process.stdout.write(this.usage());
      return;
    }
    const spec = this.nouns.get(noun);
    if (!spec) return Cli.die(`unknown command: ${noun}`, 2);
    if (spec.passthrough) return spec.passthrough([verb, ...rest].filter((a): a is string => a !== undefined));
    // Verbs are lowercase, but `api GET /v1/config` is how anyone who has used curl will type it.
    const handler = verb ? (spec.verbs?.[verb] ?? spec.verbs?.[verb.toLowerCase()]) : undefined;
    if (!handler) {
      // A noun with no verb is a question, not a mistake: answer it. `unknown: chat` for a command the
      // tool's own help documents is the least useful thing it could say.
      const listed = Cli.listVerbs(noun, spec, verb);
      if (listed) {
        process.stdout.write(listed);
        return;
      }
      return Cli.die(`unknown: ${noun} ${verb ?? ""}`.trim(), 2);
    }

    // Flags are not positional arguments: `api get /x --quiet` has one argument, not two.
    const flags = rest.filter(a => a.startsWith("--"));
    const positional = rest.filter(a => !a.startsWith("--"));

    const before = this.trace?.mark() ?? 0;
    let result: unknown;
    try {
      // Flags too: a verb that only ever saw its positional arguments could not be told to do
      // anything differently, and `--parallel` was silently dropped on the way in.
      result = await handler.run(positional, flags);
    } catch (err) {
      // What it sent and what came back, on the way out. "GET /x → 401" is the headline; the request
      // that produced it is the thing nobody can reconstruct afterwards.
      const did = this.trace?.since(before) ?? [];
      if (!flags.includes("--quiet") && did.length) {
        process.stderr.write(`${JSON.stringify({ command: `${noun} ${verb}`, did }, null, 2)}\n`);
      }
      throw err;
    }

    // `--quiet` prints the answer alone. By default the whole exchange comes back — the request, the
    // response, the statement, the timing — because the caller is usually an agent that cannot open a
    // network tab, and "it returned nothing" is not a diagnosis.
    //
    // A verb marked `raw` is the exception: what it prints IS the artefact — a config file to redirect
    // into place, an answer about this tool rather than about the product — and wrapping that in a
    // record of a request nobody made only makes it something to unwrap again.
    if (flags.includes("--quiet") || handler.raw || !this.trace) {
      if (result !== undefined) {
        process.stdout.write(typeof result === "string" ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`);
      }
      return;
    }
    process.stdout.write(
      `${JSON.stringify({ command: `${noun} ${verb}`, result, did: this.trace.since(before) }, null, 2)}\n`,
    );
  }

  /**
   * Every noun and verb registered, for whatever wants to describe this command line.
   *
   * Asked rather than listed: the instructions handed to an agent are generated from this, so a verb
   * that exists is documented and one that does not cannot be.
   */
  get commands(): { noun: string; summary: string; verbs: { verb: string; summary: string }[] }[] {
    return [...this.nouns].map(([noun, spec]) => ({
      noun,
      summary: spec.summary,
      verbs: Object.entries(spec.verbs ?? {}).map(([verb, handler]) => ({ verb, summary: handler.summary })),
    }));
  }

  /** The verbs already registered under a noun, so a caller can add to them rather than replace them. */
  /**
   * A noun with no verb is a question, not a mistake: answer it.
   *
   * Static, and returning the text rather than printing it, because the entry point answers `config`
   * itself before a description is loaded — and when it had its own copy of this branch it did not
   * have this one, so `witness config` said `unknown: config` about a noun its own help documents.
   */
  static listVerbs(noun: string, spec: Noun, verb?: string): string | undefined {
    const verbs = Object.entries(spec.verbs ?? {});
    if (verb || !verbs.length) return undefined;
    return [`${noun} — ${spec.summary}`, "", ...verbs.map(([name, h]) => `  ${name.padEnd(14)} ${h.summary}`), ""].join("\n");
  }

  verbs(noun: string): Record<string, Verb> | undefined {
    return this.nouns.get(noun)?.verbs;
  }

  usage(): string {
    const rows: string[] = [`${this.name} — drive the local stack`, "", `usage: ${this.name} <command> [args]`, ""];
    for (const [noun, spec] of this.nouns) {
      rows.push(`  ${noun.padEnd(10)} ${spec.summary}`);
      for (const [verb, h] of Object.entries(spec.verbs ?? {})) {
        rows.push(`    ${verb.padEnd(14)} ${h.summary}`);
      }
    }
    rows.push("", "Every command reports what it did — the request, the response, the timing.", "Add --quiet for the bare answer. Exit codes: 0 ok · 1 failed · 2 no such command.", "");
    return rows.join("\n");
  }

  /** A required positional argument, or exit 2 saying which one is missing. */
  static need(value: string | undefined, what: string): string {
    return value ?? Cli.die(`missing <${what}>`, 2);
  }

  /**
   * A flag's value — `--on=billing` → `billing`.
   *
   * The `=` form only, because `run` splits the line into positionals and flags before a verb sees
   * it: the space form would leave the value sitting in the positional half, where it would be read
   * as an argument.
   */
  static flag(flags: string[], name: string): string | undefined {
    const found = flags.find(f => f.startsWith(`--${name}=`));
    return found?.slice(name.length + 3);
  }

  static die(message: string, code = 1): never {
    process.stderr.write(`${message}\n`);
    process.exit(code);
  }

  /** Wire up `main`: run, and turn a thrown error into exit 1 with its message. */
  static main(cli: Cli, argv: string[] = process.argv.slice(2)): void {
    cli.run(argv).catch((err: unknown) => Cli.die(err instanceof Error ? err.message : String(err)));
  }
}

export type Verb = {
  summary: string;
  /** `args` is the positional half; `flags` is everything that started with `--`. */
  run: (args: string[], flags?: string[]) => unknown;
  /** Print the answer alone: this verb's output IS the thing wanted, not a report of a call. */
  raw?: boolean;
};
export type Noun = {
  summary: string;
  verbs?: Record<string, Verb>;
  /** Takes the rest of the line itself (a wrapper around another command). */
  passthrough?: (args: string[]) => void;
};
