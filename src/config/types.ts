import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The config's own types, read back out of the source.
 *
 * A template for a config file is documentation of a type, and hand-written documentation of a type is
 * wrong the week after it is written: a field gets added, an example does not, and the file everyone
 * copies from quietly describes last month's system. The type declaration is the only description that
 * cannot drift from the code that reads it — so the template is generated FROM it.
 *
 * This is a reader for the small corner of TypeScript those declarations use: object types, records,
 * arrays, unions, string literals and references to each other. Anything outside that corner is kept as
 * its own source text rather than guessed at, so an unrecognised construct shows up in the template as
 * what it literally says instead of silently becoming `{}`.
 */
export class TypeSource {
  private readonly raw = new Map<string, string>();
  private readonly parsed = new Map<string, TypeModel>();

  /** Index every `export type` declaration in a source tree. */
  static fromDirectory(dir: string): TypeSource {
    const source = new TypeSource();
    for (const file of TypeSource.filesUnder(dir)) source.read(fs.readFileSync(file, "utf8"));
    return source;
  }

  read(source: string): this {
    // `export type Name = <everything up to the ; that closes it>`.
    for (const match of source.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/g)) {
      const from = match.index + match[0].length;
      this.raw.set(match[1], source.slice(from, TypeSource.endOfDeclaration(source, from)).trim());
    }
    return this;
  }

  get names(): string[] {
    return [...this.raw.keys()];
  }

  has(name: string): boolean {
    return this.raw.has(name);
  }

  /** One declaration, parsed. Cached: the same types are referenced many times over. */
  declaration(name: string): TypeModel {
    const already = this.parsed.get(name);
    if (already) return already;
    const raw = this.raw.get(name);
    if (raw === undefined) throw new Error(`no exported type "${name}" — read: ${this.names.join(", ") || "nothing"}`);
    const model = this.parse(raw);
    this.parsed.set(name, model);
    return model;
  }

  /**
   * One type expression.
   *
   * Unions and intersections first, because they are the outermost thing; then the shapes; then the
   * leaves. An intersection of objects becomes one object — `Record<string, unknown> & { … }` is how a
   * type says "these fields, and anything else", and the fields are the half worth showing.
   */
  parse(text: string): TypeModel {
    const source = text.trim().replace(/;$/, "").trim();

    const union = TypeSource.split(source, "|");
    if (union.length > 1) return { kind: "union", of: union.map(part => this.parse(part)) };

    const intersection = TypeSource.split(source, "&");
    if (intersection.length > 1) {
      const parts = intersection.map(part => this.parse(part));
      const fields = parts.flatMap(part => (part.kind === "object" ? part.fields : []));
      return fields.length ? { kind: "object", fields } : parts[0];
    }

    // Before the object branch: `{ … }[]` also starts with a brace, and reading it as an object swallows
    // the `[]` into its last field's type.
    const array = /^(.+)\[\]$/s.exec(source);
    if (array) return { kind: "array", of: this.parse(array[1]) };
    const arrayOf = /^(?:Array|ReadonlyArray)<(.+)>$/s.exec(source);
    if (arrayOf) return { kind: "array", of: this.parse(arrayOf[1]) };

    if (source.startsWith("{") && source.endsWith("}")) {
      return { kind: "object", fields: this.fields(source.slice(1, -1)) };
    }

    const record = /^(?:Record|Partial)<(.+)>$/s.exec(source);
    if (record) {
      const args = TypeSource.split(record[1], ",");
      return { kind: "record", of: this.parse(args[args.length - 1]) };
    }

    if (/^["'].*["']$/s.test(source)) return { kind: "literal", text: source.slice(1, -1) };
    if (/^-?\d+(\.\d+)?$/.test(source) || source === "true" || source === "false") {
      return { kind: "literal", text: source, json: true };
    }
    if (["string", "number", "boolean", "unknown", "any", "null", "undefined", "never", "object"].includes(source)) {
      return { kind: "primitive", name: source };
    }
    if (/^[A-Za-z_$][\w$]*$/.test(source)) {
      return this.has(source) ? { kind: "ref", name: source } : { kind: "opaque", text: source };
    }
    // A function type, a `keyof`, an imported generic: real TypeScript this reader does not model. Kept
    // verbatim so the template says what the type says rather than inventing a shape for it.
    return { kind: "opaque", text: source.replace(/\s+/g, " ") };
  }

  /** The members of an object type body, with the doc comment that precedes each. */
  private fields(body: string): TypeField[] {
    const out: TypeField[] = [];
    for (const member of TypeSource.split(body, ";,")) {
      const { doc, rest } = TypeSource.takeComments(member);
      const named = /^(\[[^\]]+\]|"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*/s.exec(rest);
      if (!named) continue;
      const type = this.parse(rest.slice(named[0].length));
      // `[key: string]: T` is a record written inline — the name is a placeholder, not a field.
      if (named[1].startsWith("[")) {
        out.push({ name: "*", optional: true, doc, type });
        continue;
      }
      out.push({ name: named[1].replace(/^["']|["']$/g, ""), optional: named[2] === "?", doc, type });
    }
    return out;
  }

  /** Where a declaration ends: the first `;` outside a brace, bracket, paren, angle or string. */
  private static endOfDeclaration(source: string, from: number): number {
    for (const [index, depth, inString] of TypeSource.walk(source.slice(from))) {
      if (!inString && depth === 0 && source[from + index] === ";") return from + index;
    }
    return source.length;
  }

  /** Split on any of `separators`, at depth 0 only. Leading separators (`= | A | B`) are ignored. */
  private static split(text: string, separators: string): string[] {
    const parts: string[] = [];
    let start = 0;
    for (const [index, depth, inString, inComment] of TypeSource.walk(text)) {
      if (!inString && !inComment && depth === 0 && separators.includes(text[index])) {
        parts.push(text.slice(start, index));
        start = index + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map(p => p.trim()).filter(Boolean);
  }

  /**
   * Character positions with their nesting depth, string state and comment state.
   *
   * One walker for every scan here, because "is this character inside a string?" is the question every
   * one of them gets wrong on its own — and a `//` inside a URL in a doc comment is not a comment.
   */
  private static *walk(text: string): Generator<[number, number, boolean, boolean]> {
    let depth = 0;
    let quote = "";
    let comment: "" | "line" | "block" = "";
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quote) {
        if (char === "\\") i += 1;
        else if (char === quote) quote = "";
        yield [i, depth, true, false];
        continue;
      }
      if (comment) {
        if (comment === "line" && char === "\n") comment = "";
        else if (comment === "block" && char === "*" && text[i + 1] === "/") {
          comment = "";
          i += 1;
        }
        yield [i, depth, false, true];
        continue;
      }
      if (char === "/" && text[i + 1] === "/") comment = "line";
      else if (char === "/" && text[i + 1] === "*") comment = "block";
      else if (char === '"' || char === "'" || char === "`") quote = char;
      else if ("{[(".includes(char)) depth += 1;
      else if ("}])".includes(char)) depth -= 1;
      // Angles nest like brackets in `Record<string, T>` but not in `(x) => y`, which is the same two
      // characters meaning something else entirely.
      else if (char === "<" && text[i - 1] !== "=") depth += 1;
      else if (char === ">" && text[i - 1] !== "=") depth -= 1;
      yield [i, depth, false, comment !== ""];
    }
  }

  /** Split a member into its doc comment and the declaration itself. */
  private static takeComments(member: string): { doc?: string; rest: string } {
    const lines: string[] = [];
    let rest = member.trim();
    for (;;) {
      const block = /^\/\*\*?([\s\S]*?)\*\//.exec(rest);
      if (block) {
        lines.push(
          ...block[1]
            .split("\n")
            .map(l => l.replace(/^\s*\*/, "").trim())
            .filter(Boolean),
        );
        rest = rest.slice(block[0].length).trim();
        continue;
      }
      const line = /^\/\/(.*)\n/.exec(rest);
      if (line) {
        lines.push(line[1].trim());
        rest = rest.slice(line[0].length).trim();
        continue;
      }
      break;
    }
    return { doc: lines.join(" ") || undefined, rest };
  }

  private static filesUnder(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      .map(entry => path.join(entry.parentPath, entry.name))
      .sort();
  }
}

export type TypeField = { name: string; optional: boolean; doc?: string; type: TypeModel };

export type TypeModel =
  | { kind: "object"; fields: TypeField[] }
  /** `Record<string, T>` — keys the config author chooses. */
  | { kind: "record"; of: TypeModel }
  | { kind: "array"; of: TypeModel }
  | { kind: "union"; of: TypeModel[] }
  /** A literal the config must say verbatim. `json` marks the ones that are not strings. */
  | { kind: "literal"; text: string; json?: boolean }
  | { kind: "primitive"; name: string }
  | { kind: "ref"; name: string }
  /** Real TypeScript this reader does not model, kept as its own source text. */
  | { kind: "opaque"; text: string };
