import * as fs from "node:fs";
import * as path from "node:path";

import { normalise, unfilled } from "./normalise.ts";
import type { SystemConfig } from "./schema.ts";

/** Read and parse a config file. Relative paths resolve against the working directory. */
export function loadConfig(file: string): SystemConfig {
  const resolved = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  return readConfig(fs.readFileSync(resolved, "utf8"), resolved);
}

/**
 * The same reading, of text that is not on disk yet.
 *
 * Split out for the writing half of this surface, which has to decide whether a change is safe BEFORE
 * it makes it. "Validated before written" can only honestly mean one thing — the result, read by the
 * reader that is going to read it — and a second, kinder copy of these three steps would let through
 * exactly the descriptions that pass the writer and fail the loader.
 */
export function readConfig(source: string, from: string): SystemConfig {
  const config = JSON.parse(withoutComments(source)) as SystemConfig;
  // Said here, where the file is, rather than three layers down as `no client provider "…"` — an
  // error about a registry, naming neither the field nor the file, as the first thing a new project
  // sees. The template is meant to be cut down to what a product has; this says what is left.
  const blank = unfilled(config);
  if (blank.length) {
    throw new Error(
      `${from} is still the generated template: ${blank.length} field${blank.length === 1 ? "" : "s"} ` +
        `still say "…" — ${blank.slice(0, 5).join(", ")}${blank.length > 5 ? `, and ${blank.length - 5} more` : ""}. ` +
        `Cut it down to what this product actually has, and delete the rest.`,
    );
  }
  // Hoisted here, once, so nothing downstream ever sees the shape it was written in.
  return normalise(config);
}

/**
 * JSON, but comments are allowed.
 *
 * A config is the description of a product, and the reasoning belongs beside the thing it explains —
 * which sandbox this key is for, why this fixture and not another. `JSON.parse` refuses comments, so
 * they are removed here rather than being kept in a `"why"` field nothing reads. It is also what makes
 * the generated template a file you can start from: the documentation is in it.
 *
 * A `//` inside a string is not a comment, which is most of what this has to get right — half the URLs
 * in a config contain one.
 */
export function withoutComments(source: string): string {
  let out = "";
  let quote = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 1;
      } else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') {
      quote = true;
      out += char;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * Fill `{name}` placeholders from a bag of values. Anything left unfilled is an error, not a blank.
 *
 * A dotted name reaches into what a step stored: `{stats.dashboards}` after an `api` step kept the
 * whole answer, `{offered.length}` for how many things a `store` read off the screen. Without that,
 * comparing one layer against another meant a program, which is the one thing a description is for
 * avoiding.
 *
 * A **doubled** brace is not a placeholder — `{{…}}` is left exactly as it stands. Not every string
 * that reaches here was written as a template: `docker ps --format '{{.Names}}'` is a command
 * somebody meant literally, and reading `{.Names}` out of it threw `missing {.Names}` on a step that
 * had no parameters in it at all. Doubling is the escape because it is also the only form anyone
 * writes by accident, so the text that provoked the bug is the text that now works.
 */
export function fill(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/\{\{[^{}]*\}\}|\{([\w.]+)\}/g, (literal: string, key: string | undefined) => {
    if (key === undefined) return literal;
    const value = reach(params, key);
    if (value === undefined) throw new Error(`missing {${key}} for "${template}"`);
    // Objects and arrays as JSON, not as `[object Object]`. A step that stores what an API answered
    // stores an object, and a note or a caption interpolating it got the useless form — silently, in
    // the files whose whole job is being readable afterwards.
    return asText(value);
  });
}

/**
 * Whatever it is, as text — and never as `[object Object]`.
 *
 * Each branch is a type that has a sensible string form, so nothing has to be cast into pretending.
 */
export function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return value.description ?? "";
  if (typeof value === "function") return value.name;
  return JSON.stringify(value);
}

/**
 * One value out of a bag, by a dotted path.
 *
 * `length` on an array is a real property, so `{rows.length}` needs no special case. A JSON string
 * that a step stored whole is parsed on the way through: what the API answered is usually text, and
 * the reason to keep it was to look inside it.
 */
export function reach(params: Record<string, unknown>, key: string): unknown {
  const [head, ...rest] = key.split(".");
  let at: unknown = params[head];
  for (const step of rest) {
    if (typeof at === "string") {
      try {
        at = JSON.parse(at);
      } catch {
        // Not JSON, so there is nothing further in: `{name.length}` on a plain string still works.
      }
    }
    if (at === null || at === undefined) return undefined;
    at = (at as Record<string, unknown>)[step];
  }
  return at;
}
