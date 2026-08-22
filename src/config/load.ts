import * as fs from "node:fs";
import * as path from "node:path";

import type { SystemConfig } from "./schema.ts";

/** Read and parse a config file. Relative paths resolve against the working directory. */
export function loadConfig(file: string): SystemConfig {
  const resolved = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  return JSON.parse(withoutComments(fs.readFileSync(resolved, "utf8"))) as SystemConfig;
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

/** Fill `{name}` placeholders from a bag of values. Anything left unfilled is an error, not a blank. */
export function fill(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`missing {${key}} for "${template}"`);
    return String(value);
  });
}
