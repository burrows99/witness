import * as fs from "node:fs";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { Jsonc, isBlock, merged } from "./edit.ts";
import { readConfig, withoutComments } from "./load.ts";
import { unfilled } from "./normalise.ts";
import { Template } from "./template.ts";
import { TypeSource } from "./types.ts";
import type { ActionConfig } from "../actions/engine.ts";
import type { SystemConfig } from "./schema.ts";

/**
 * Changing a description, without editing the text of one.
 *
 * The reading half of this surface has always been here — `config template` prints, `config explore`
 * walks and prints, `action list` and `action show` read. Nothing wrote. So after the first minute,
 * authoring was editing `.witness/config.jsonc` by hand, and for an agent that means splicing strings:
 * an anchor whose uniqueness is checked by hand, an indentation counted by hand, and a result nothing
 * validates until the next command happens to load it — which may be a browser two minutes into a run.
 *
 * Three properties, and they matter more than the spelling of the verbs:
 *
 * - **Validated before written.** A refusal leaves the file byte-identical and says what was wrong
 *   with the INPUT. The check is `readConfig` — the reader every command uses — run over the text the
 *   write WOULD produce, so nothing can pass here and fail there.
 * - **Comments survive.** See {@link Jsonc}. This file decides what is safe; that one decides what
 *   the bytes become, and it never reprints a line it was not asked to change.
 * - **Idempotent and addressable.** Adding the same action twice is one action, and it says so rather
 *   than erroring or duplicating. The caller names WHAT to change; nothing here takes an offset.
 *
 * Reached from `bin/`, not from `src/index.ts`, for the reason `Template` and `Skill` are: it reads
 * witness's own type declarations to know what a step verb is, and finding those goes through
 * `import.meta`, which a bundler transpiling to CommonJS cannot parse.
 */
export class Author {
  /**
   * A fragment, applied — the shape `config explore` already prints.
   *
   * The loop that could not close: `explore` generated exactly the block a description wants and its
   * own header told the reader to merge it by hand. Deep for objects, wholesale for everything else;
   * fields already agreeing are not touched at all, so re-merging a fragment against an unchanged app
   * writes nothing.
   */
  static merge(file: string, fragment: string): Change {
    const block = fragmentOf(fragment);
    return Author.change(file, "wrote", (was, doc) => ({ ...doc.merge(block), expected: merged(was, block), subject: "the description" }));
  }

  /**
   * One field, addressed the way `config template` documents it: `services.gitea.port`.
   *
   * A scalar or a list. A BLOCK is refused and pointed at `merge`, because "set this field to this
   * object" has two readings — replace it, or merge into it — and a verb whose meaning depends on
   * what is already in the file is the thing this whole surface exists to stop being.
   *
   * A key containing a dot cannot be addressed here; that is what `merge` is for.
   */
  static set(file: string, field: string, value: string): Change {
    const at = field.split(".");
    if (!field || at.some(part => !part)) throw new Error(`"${field}" is not a field — a field is dotted, like \`services.gitea.port\`.`);
    const parsed = valueOf(value);
    if (isBlock(parsed)) throw new Error(`${value} is a block, and \`config set\` writes one field. \`config merge\` takes a block.`);
    const block = nest(at, parsed);
    // The field asked for, not where the splice happened to land. Setting `services.gitea.app.routes.home`
    // on a service with no `app` yet is one splice at `services.gitea`, and reporting THAT back
    // answers a question nobody asked.
    return Author.change(file, "wrote", (was, doc) => ({ ...doc.merge(block), changed: [field], expected: merged(was, block), subject: field }));
  }

  /**
   * One action, validated and placed under the service that owns it.
   *
   * `<service>.<name>` writes it into that service's own `actions`, where it needs no `app` and no
   * prefix typed into its own name; a bare name goes to the top level, which is where an action about
   * more than one service belongs. Takes either a whole action (`{ "summary": …, "steps": [ … ] }`) or
   * the step list on its own, because both are things a caller has in front of it.
   */
  static addAction(file: string, name: string, declared: string): Change {
    return Author.change(file, "wrote", (was, doc) => {
      const at = placeOf(was, name);
      const block = nest(at, checked(name, inputOf(declared)));
      // The action, not the splice: adding the first action a service has ever had is one insert at
      // `services.<name>`, and naming that back reads as having written something else.
      return { ...doc.merge(block), changed: [at.join(".")], expected: merged(was, block), subject: at.join(".") };
    });
  }

  /** One action, dropped — with the note written above it, which describes what is no longer there. */
  static removeAction(file: string, name: string): Change {
    return Author.change(file, "removed", (was, doc) => {
      const at = placeToRemove(was, name);
      const { source, cut } = doc.remove(at);
      // The name that was typed, for the case where there was nothing to remove: reporting the path
      // it resolved to answers a question about a field that does not exist.
      if (!cut) return { source, changed: [], expected: was, subject: `"${name}"` };
      return {
        source,
        changed: [at.join(".")],
        // What was actually cut, which is the block rather than the action whenever the action was
        // the only thing in it.
        expected: without(was, cut),
        subject: `"${name}"`,
        ...(cut.length < at.length ? { note: `and ${cut.join(".")} with it, which held nothing else` } : {}),
      };
    });
  }

  /**
   * What all four share: read it, edit it, check what the edit produced, and only then write.
   *
   * The order is the whole point. Nothing touches the disk until the text that would land there has
   * been read back — so a refusal is a file that was never opened for writing, rather than one that
   * has to be put back.
   */
  private static change(file: string, verb: "wrote" | "removed", how: (was: SystemConfig, doc: Jsonc) => Written): Change {
    const at = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    const before = fs.readFileSync(at, "utf8");
    const shown = shortest(at);
    const was = current(before, shown);

    const { source, changed, expected, subject, note } = how(was, Jsonc.parse(before));
    if (source === before) {
      const said = verb === "removed" ? `${subject} is not in ${shown} — nothing removed` : `${subject} is already what ${shown} says — nothing written`;
      return { file: at, changed: [], wrote: false, summary: said };
    }

    const wrong = refused(before, source, expected, was, shown);
    if (wrong) throw new Error(wrong);
    fs.writeFileSync(at, source);
    const said = `${verb} ${changed.join(", ")} ${verb === "removed" ? "from" : "to"} ${shown}`;
    return { file: at, changed, wrote: true, summary: note ? `${said}, ${note}` : said };
  }
}

export type Change = {
  /** The description that was written, or that would have been. */
  file: string;
  /** What moved, each addressed the way `config set` addresses a field. Empty when nothing did. */
  changed: string[];
  /** Whether anything reached the disk. The same add twice is one action, and the second says so. */
  wrote: boolean;
  /** One line, for whoever typed the command — which is as often an agent as a person. */
  summary: string;
};

/** What one edit produced, before anything has decided whether it is allowed to land. */
type Written = {
  source: string;
  /** What moved, as the caller would address it — not necessarily where the splice went. */
  changed: string[];
  /** The same change made to the VALUES, which is what the text is checked against. */
  expected: unknown;
  /** What to call it in the sentence for a change that turned out to be no change at all. */
  subject: string;
  /** Anything else the caller should know happened, appended to the sentence. */
  note?: string;
};

/**
 * Every reason to refuse, asked of the TEXT, before it reaches the disk.
 *
 * Four questions in the order they can be answered. The first two are about this code and say so:
 * the input was checked before the splice, so a splice that does not parse, or that lands somewhere
 * other than where it was aimed, is a defect here — and an error blaming the caller's fragment would
 * send whoever reads it to stare at a fragment that is fine.
 */
function refused(before: string, after: string, expected: unknown, was: SystemConfig, file: string): string | undefined {
  let now: unknown;
  try {
    now = JSON.parse(withoutComments(after));
  } catch (err) {
    return `witness spliced ${file} into something that is no longer JSON (${message(err)}). Nothing was written; this is a bug in witness.`;
  }
  // The one check that makes preserving comments safe: a writer that edits text by offset can land in
  // the wrong place, and the only thing that can say so is the VALUE the file now holds, compared
  // against the value the same merge produces with no text involved at all.
  if (!isDeepStrictEqual(now, expected)) {
    return `witness edited ${file} into something other than what was asked for. Nothing was written; this is a bug in witness.`;
  }

  // Placeholders the CHANGE introduced. Not the ones already there: a description that is still the
  // generated template is exactly the one somebody is part-way through filling in, and refusing to
  // write to it would take this surface away at the moment it is most useful.
  const already = new Set(unfilled(was));
  const introduced = unfilled(now as SystemConfig).filter(field => !already.has(field));
  if (introduced.length) {
    return (
      `that would write "…" — the placeholder \`config template\` puts where a value goes — into ` +
      `${introduced.slice(0, 5).join(", ")}${introduced.length > 5 ? `, and ${introduced.length - 5} more` : ""}. ` +
      `Fill those in first. Nothing was written.`
    );
  }

  // And the same reading every command does. Only counted against a description that reads NOW —
  // one that does not is the fresh `init` template, and a change to it is a repair.
  try {
    readConfig(after, file);
  } catch (err) {
    if (loads(before, file)) return `that would leave ${file} unreadable: ${message(err)}. Nothing was written.`;
  }
  return undefined;
}

function loads(source: string, file: string): boolean {
  try {
    readConfig(source, file);
    return true;
  } catch {
    // Not a failure: the question was whether it reads, and the answer is no.
    return false;
  }
}

/** What the file says now. A description that cannot be parsed cannot be found a field in by name. */
function current(source: string, file: string): SystemConfig {
  try {
    return JSON.parse(withoutComments(source)) as SystemConfig;
  } catch (err) {
    throw new Error(
      `${file} is not valid JSONC (${message(err)}), so nothing here can find a field in it by name. ` +
        `Fix it by hand — or \`git checkout\` it — first.`,
      { cause: err },
    );
  }
}

/** A fragment as it arrives: JSONC, because that is what `config explore` prints. */
function fragmentOf(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutComments(text));
  } catch (err) {
    throw new Error(`that is not a JSONC fragment: ${message(err)}. \`config explore <service>\` prints one in exactly the right shape.`, { cause: err });
  }
  if (!isBlock(parsed)) throw new Error(`a fragment is an object of config fields, and this is ${shapeOf(parsed)}. \`config explore <service>\` prints one.`);
  return parsed;
}

/** An action as it arrives: the whole thing, or the step list on its own. */
function inputOf(text: string): unknown {
  try {
    return JSON.parse(withoutComments(text));
  } catch (err) {
    throw new Error(`that is not a JSONC action: ${message(err)}. It is either \`{ "steps": [ … ] }\` or the step list on its own.`, { cause: err });
  }
}

/**
 * An action, checked against the types the engine reads it with, before it is written.
 *
 * The unknown-key check is the one worth having. A step is dispatched by an `if` per verb, so a key
 * the runner does not recognise is not an error — it is nothing at all. `{ "clik": … }` runs, passes,
 * photographs the screen it did not touch, and reports a green action that moved nothing. Caught at
 * the moment it is typed, it is one line; caught by a browser two minutes into a run, it is an
 * afternoon of reading frames that all look correct.
 */
function checked(name: string, input: unknown): ActionConfig {
  const action = Array.isArray(input) ? { steps: input } : input;
  if (!isBlock(action)) throw new Error(`an action is \`{ "steps": [ … ] }\` or the step list on its own, and this is ${shapeOf(input)}.`);

  const fields = fieldsOf("ActionConfig");
  const stray = Object.keys(action).filter(key => !fields.has(key));
  if (stray.length) throw new Error(`"${name}" declares ${quoted(stray)}, which an action has no field called. Fields: ${[...fields].join(", ")}`);

  const steps: unknown = action.steps;
  if (!Array.isArray(steps) || !steps.length) {
    throw new Error(`"${name}" needs a non-empty "steps" array — an action with no steps runs, passes, and proves nothing.`);
  }

  const verbs = fieldsOf("StepConfig");
  steps.forEach((step: unknown, index) => {
    const at = `step ${index + 1} of "${name}"`;
    if (!isBlock(step)) throw new Error(`${at} is ${shapeOf(step)}, not an object. A step is one verb and its arguments: { "goto": { "route": "home" } }`);
    const keys = Object.keys(step);
    if (!keys.length) throw new Error(`${at} is empty, so it names no verb. Verbs: ${[...verbs].join(", ")}`);
    const unknown = keys.filter(key => !verbs.has(key));
    if (unknown.length) {
      throw new Error(
        `${at} says ${quoted(unknown)}, which no step verb is called. The runner dispatches one verb at a time and ` +
          `does nothing at all with a key it does not know, so this would have run green and moved nothing. Verbs: ${[...verbs].join(", ")}`,
      );
    }
  });
  return action as ActionConfig;
}

/**
 * Where an action lives in the FILE, which is not where `action run` finds it.
 *
 * `action list` prints `gitea.register` because that is the name the loader hoists it to; in the file
 * it is `services.gitea.actions.register`, with the prefix being where it sits rather than something
 * anybody typed. Both halves of that are the caller's vocabulary, so both are accepted, and the
 * translation happens once, here.
 */
function placeOf(config: SystemConfig, name: string): string[] {
  const dot = name.indexOf(".");
  if (dot <= 0) return ["actions", name];
  const service = name.slice(0, dot);
  if (!config.services?.[service]) {
    throw new Error(
      `no service "${service}" — declared: ${Object.keys(config.services ?? {}).join(", ") || "none"}. ` +
        `A name with no dot in it goes in the top-level \`actions\` block, which is for an action about more than one service.`,
    );
  }
  return ["services", service, "actions", name.slice(dot + 1)];
}

/**
 * The same question for a name being dropped, which may be bare.
 *
 * `action run` takes a bare name whenever exactly one service declares it, and refuses to guess when
 * two do. Removing something is the operation where guessing is least forgivable, so it answers the
 * same way rather than a friendlier one.
 */
function placeToRemove(config: SystemConfig, name: string): string[] {
  if (name.includes(".")) return placeOf(config, name);
  if (config.actions?.[name]) return ["actions", name];
  const owners = Object.entries(config.services ?? {})
    .filter(([, service]) => service.actions?.[name])
    .map(([service]) => service);
  if (owners.length > 1) {
    throw new Error(`"${name}" is declared by ${owners.length} services — name the one you mean: ${owners.map(owner => `${owner}.${name}`).join(", ")}`);
  }
  return owners.length ? ["services", owners[0], "actions", name] : ["actions", name];
}

/** The description without one field, for comparing against what the splice actually produced. */
function without(config: SystemConfig, at: string[]): SystemConfig {
  const copy = structuredClone(config);
  let node = copy as Record<string, unknown>;
  for (const key of at.slice(0, -1)) node = node[key] as Record<string, unknown>;
  delete node[at[at.length - 1]];
  return copy;
}

/** `["services", "gitea", "port"]` and `3020` → `{ services: { gitea: { port: 3020 } } }`. */
function nest(at: string[], value: unknown): Record<string, unknown> {
  return at.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;
}

/**
 * What a value typed at a shell means.
 *
 * JSON first, because a port is a number: `config set services.gitea.port 3020` writing the STRING
 * "3020" is a description that lies about its own type, and the place that finds out is a URL built
 * out of it. Anything JSON refuses is the text itself, which is what
 * `config set services.gitea.app.routes.home /` has to mean.
 */
function valueOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON, so it is what it says. `/`, `witness-admin`, `select 1` — none of those are JSON and
    // all of them are values a description holds.
    return text;
  }
}

/**
 * Every field of one of the config's own types, read back out of the source.
 *
 * The same source the template and the skill are generated from, for the same reason: a hand-kept
 * list of step verbs would be wrong the week after somebody added one, and the failure would be this
 * command refusing a step the runner supports.
 */
function fieldsOf(name: string): Set<string> {
  const already = fields.get(name);
  if (already) return already;
  const model = types().declaration(name);
  if (model.kind !== "object") throw new Error(`${name} is not an object type, so it has no fields to check against`);
  const found = new Set(model.fields.map(field => field.name));
  fields.set(name, found);
  return found;
}

const fields = new Map<string, Set<string>>();
let read: TypeSource | undefined;

/**
 * The type declarations, indexed once.
 *
 * Module-level rather than per-call because a thirty-step action would otherwise walk `src/` thirty
 * times, and what is cached is the source on disk, which does not change while a command runs.
 */
function types(): TypeSource {
  read ??= TypeSource.fromDirectory(Template.sourceDir());
  return read;
}

/** The shorter of the two ways to say where a file is — `.witness/config.jsonc`, not `../../../tmp/x`. */
function shortest(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith("..") ? relative : file;
}

/** What something IS, for an error that has to tell somebody what they typed. */
function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

function quoted(names: string[]): string {
  return names.map(name => `"${name}"`).join(", ");
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
