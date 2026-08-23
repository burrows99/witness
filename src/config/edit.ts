import { isDeepStrictEqual } from "node:util";

import { withoutComments } from "./load.ts";

/**
 * A JSONC document that can be changed without being reprinted.
 *
 * This is the hard half of writing to a description, and the reason it is a file of its own. A config
 * carries hundreds of lines of load-bearing prose — `init`'s generated header, `explore`'s notes about
 * what it could not walk, and whatever the author wrote about why this fixture and not another. The
 * obvious writer is `JSON.parse`, change the object, `JSON.stringify` it back, and it is unusable
 * here: it drops every comment in the file and reflows every line that was formatted by hand, so a
 * one-field change diffs as the whole file and nobody can review it. That is strictly worse than the
 * `str.replace` it would be replacing, which at least leaves the other four hundred lines alone.
 *
 * So nothing is reprinted. The source is parsed into a tree that remembers the OFFSETS of everything
 * in it, an edit is a splice at one of those offsets, and every byte outside the spliced span comes
 * out exactly as it went in. Comments survive by never being touched — which is also why they survive
 * comments this parser does not understand, and formatting nobody here anticipated.
 *
 * What it costs, said plainly because it is a real cost and not a footnote:
 *
 * - **A value that is REPLACED loses the comments inside it.** Writing a new step list over an old one
 *   splices out the old text, notes and all. The rule is narrow — only the span of the value actually
 *   being written — but where it bites, it bites completely.
 * - **An array is replaced whole, never merged.** There is no honest elementwise merge of two step
 *   lists: nothing says whether a step at index 3 is the same step. Replacing says what happened.
 * - **A fragment's own comments do not travel.** `config explore` prints notes above its JSON about
 *   what it could not walk; those are a report about the crawl, and there is no defensible place to
 *   put them inside the file. They stay in the terminal.
 * - **The file has to parse.** A description broken by an earlier hand-edit cannot be navigated by
 *   offset, so this refuses rather than guessing. That is what `git checkout` is for.
 */
export class Jsonc {
  private readonly source: string;
  private readonly root: Node;

  private constructor(source: string) {
    this.source = source;
    this.root = read(source);
  }

  /** Parse a JSONC document. Throws if it is not one — an offset into text nobody can parse is fiction. */
  static parse(source: string): Jsonc {
    return new Jsonc(source);
  }

  /**
   * A fragment, applied field by field.
   *
   * Deep for objects and wholesale for everything else, which is the only merge a config can mean: a
   * fragment naming `services.gitea.app.routes` must not delete `services.gitea.api` it never
   * mentioned, and a fragment naming `steps` must not interleave itself with the steps already there.
   *
   * A field the file already agrees with is not written at all — not rewritten identically, not
   * reformatted. That is what makes the same add twice one action, and it is also what keeps a
   * re-merged `explore` fragment out of the diff.
   *
   * Returns what changed, addressed the way `config set` addresses a field, so the caller can say.
   */
  merge(fragment: Record<string, unknown>): { source: string; changed: string[] } {
    if (this.root.kind !== "object") throw new Error("the description is not a JSON object, so there is nothing to merge into");
    const edits: Edit[] = [];
    const changed: string[] = [];
    this.into(this.root, fragment, [], edits, changed);
    return { source: splice(this.source, edits), changed };
  }

  /**
   * Drop one field, and the note written above it.
   *
   * A comment block directly above a member, with no blank line between, documents that member: left
   * behind it becomes prose about something that is not there, which is worse than no prose. A blank
   * line ends the block, so a comment introducing the whole section stays.
   *
   * Answers nothing removed, rather than throwing, when the field is not there — a caller that asked
   * for something absent to go has got what it wanted. What comes back is what was actually CUT,
   * which is not always what was asked for: see the empty-block rule below.
   */
  remove(path: string[]): { source: string; cut?: string[] } {
    const parent = this.objectAt(path.slice(0, -1));
    const index = parent?.members.findIndex(member => member.key === path[path.length - 1]) ?? -1;
    if (!parent || index < 0) return { source: this.source };

    // The block that held it, when it held nothing else. `"actions": {}` left behind after the last
    // action is removed is a field claiming a service declares actions, and the next thing to read it
    // has to decide whether somebody meant it — so the block goes with its last member, along with
    // whatever was written above the block.
    if (parent.members.length === 1 && path.length > 1) return this.remove(path.slice(0, -1));

    const member = parent.members[index];
    const previous = parent.members[index - 1];
    const floor = previous ? previous.value.end : parent.start + 1;

    // Forward: the value, the comma after it, and any note sitting on the same line as either.
    let to = this.lineEnd(this.past(member.value.end, ","));
    while (this.source[to] === " " || this.source[to] === "\t") to += 1;
    if (this.source[to] === "\n") to += 1;
    // Back: the start of its own line, then the lines of `//` above it. Clamped at whatever came
    // before, so removing the first member of an object written on one line cannot eat the brace.
    const from = this.commentsAbove(Math.max(this.source.lastIndexOf("\n", member.start) + 1, floor), floor);

    const edits: Edit[] = [{ start: from, end: to, text: "" }];
    // The comma that separated it from the member before is only in the text when something follows
    // it. Removing the LAST member leaves that comma dangling in front of the closing brace.
    //
    // Unless the span above already took it: on an object written all on one line there is no line
    // start to cut back to, so `from` lands on the previous member's own end and the comma is inside
    // what is already going. Two edits over one comma splice twice and corrupt what is between them.
    if (index === parent.members.length - 1 && previous) {
      const comma = this.past(previous.value.end, ",");
      if (comma > previous.value.end && comma - 1 < from) edits.push({ start: comma - 1, end: comma, text: "" });
    }
    return { source: splice(this.source, edits), cut: path };
  }

  /** Merge a fragment into one object, collecting the splices rather than making them. */
  private into(object: ObjectNode, fragment: Record<string, unknown>, at: string[], edits: Edit[], changed: string[]): void {
    // Gathered rather than emitted one at a time: two new members of the same object are one splice
    // at its tail, and two splices at the same offset would be applied in whichever order they were
    // sorted into.
    const additions: [string, unknown][] = [];
    for (const [key, value] of Object.entries(fragment)) {
      const where = [...at, key].join(".");
      const member = object.members.find(existing => existing.key === key);
      if (!member) {
        additions.push([key, value]);
        changed.push(where);
        continue;
      }
      if (isBlock(value) && member.value.kind === "object") {
        this.into(member.value, value, [...at, key], edits, changed);
        continue;
      }
      // Already what was asked for: leave the bytes alone. Rewriting an identical value would drop
      // whatever is written inside it, for no change at all.
      if (isDeepStrictEqual(this.valueOf(member.value), value)) continue;
      edits.push({ start: member.value.start, end: member.value.end, text: this.render(value, this.indentOf(member.start)) });
      changed.push(where);
    }
    if (additions.length) edits.push(...this.insert(object, additions));
  }

  /** New members, written at the end of an object, in the indentation the object is already using. */
  private insert(object: ObjectNode, additions: [string, unknown][]): Edit[] {
    const indent = this.memberIndent(object);
    const body = additions.map(([key, value]) => `${JSON.stringify(key)}: ${this.render(value, indent)}`).join(`,\n${indent}`);

    const inside = this.source.slice(object.start, object.end);

    // An object somebody already wrote on one line grows on that line — `"routes": { "home": "/" }`
    // is how a description is written, and a fourth route arriving as three lines of its own would
    // reformat a block nobody asked to have reformatted. Only where there is a style to match: an
    // empty `{}` is a placeholder rather than a decision, so it falls through and expands.
    if (object.members.length && !inside.includes("\n")) {
      const inline = additions.map(([key, value]) => `${JSON.stringify(key)}: ${Jsonc.flat(value)}`).join(", ");
      // Against the last member rather than against the brace, so whatever spacing that brace had
      // stays the spacing it has.
      const at = object.members[object.members.length - 1].value.end;
      return [{ start: at, end: at, text: `, ${inline}` }];
    }

    if (!object.members.length) {
      // Nothing but whitespace between the braces: both of them get their own line back. With a
      // comment in there instead, the comment is what is between them, and it stays where it is.
      if (/^\s*$/.test(inside.slice(1, -1))) {
        return [{ start: object.start + 1, end: object.end - 1, text: `\n${indent}${body}\n${this.indentOf(object.start)}` }];
      }
      const open = this.lineEnd(object.start + 1);
      return [{ start: open, end: open, text: `\n${indent}${body}` }];
    }

    const last = object.members[object.members.length - 1];
    const after = this.lineEnd(last.value.end);
    // The comma belongs against the value; the new line belongs after whatever note follows it. When
    // there is no note the two are the same place, and one splice is both.
    return after === last.value.end
      ? [{ start: after, end: after, text: `,\n${indent}${body}` }]
      : [
          { start: last.value.end, end: last.value.end, text: "," },
          { start: after, end: after, text: `\n${indent}${body}` },
        ];
  }

  /**
   * A value as text, at the depth it is being written at — and on ONE line wherever it fits.
   *
   * `JSON.stringify(value, null, 2)` gives every key a line of its own, and no description in this
   * repository or any other is written that way: a step is `{ "goto": { "route": "home" } }`, and a
   * step list exploded to four lines a step is the same content in five times the diff. The whole
   * argument for preserving comments is that an edit stays reviewable, and a reviewable edit is also
   * one that looks like the file it landed in.
   */
  private render(value: unknown, indent: string): string {
    const flat = Jsonc.flat(value);
    if (indent.length + flat.length <= WIDTH) return flat;
    const inner = indent + this.unit;
    if (Array.isArray(value)) {
      return `[\n${value.map(item => inner + this.render(item, inner)).join(",\n")}\n${indent}]`;
    }
    if (isBlock(value)) {
      const entries = Object.entries(value);
      return `{\n${entries.map(([key, inside]) => `${inner}${JSON.stringify(key)}: ${this.render(inside, inner)}`).join(",\n")}\n${indent}}`;
    }
    // A single value longer than the width is still a single value: a long URL has nowhere to break.
    return flat;
  }

  /** The one-line form, spaced the way a config is written: `{ "goto": { "route": "home" } }`. */
  private static flat(value: unknown): string {
    if (Array.isArray(value)) return value.length ? `[${value.map(item => Jsonc.flat(item)).join(", ")}]` : "[]";
    if (isBlock(value)) {
      const entries = Object.entries(value);
      return entries.length ? `{ ${entries.map(([key, inside]) => `${JSON.stringify(key)}: ${Jsonc.flat(inside)}`).join(", ")} }` : "{}";
    }
    return JSON.stringify(value) ?? "null";
  }

  /** What a node says, read the way every other reader of this file reads it. */
  private valueOf(node: Node): unknown {
    return JSON.parse(withoutComments(this.source.slice(node.start, node.end)));
  }

  private objectAt(path: string[]): ObjectNode | undefined {
    let node: Node = this.root;
    for (const key of path) {
      if (node.kind !== "object") return undefined;
      const member = node.members.find(existing => existing.key === key);
      if (!member) return undefined;
      node = member.value;
    }
    return node.kind === "object" ? node : undefined;
  }

  /**
   * The indentation this file is written in.
   *
   * Read off the file rather than assumed, because what is written has to look like what is already
   * there — a two-space file that grows a four-space block diffs as if somebody reformatted it.
   */
  private get unit(): string {
    return /\n([ \t]+)\S/.exec(this.source)?.[1] ?? "  ";
  }

  /** The whitespace at the start of the line an offset is on. */
  private indentOf(offset: number): string {
    const from = this.source.lastIndexOf("\n", offset) + 1;
    return /^[ \t]*/.exec(this.source.slice(from, offset))![0];
  }

  /** What one member of an object is indented by — from a sibling, or from the object's own line. */
  private memberIndent(object: ObjectNode): string {
    const first = object.members[0];
    if (first) {
      const from = this.source.lastIndexOf("\n", first.start) + 1;
      const before = this.source.slice(from, first.start);
      // Only when the member starts its own line. An object written inline has no indentation of its
      // own to copy, and taking the whole line's would indent a new member to the wrong depth.
      if (/^[ \t]*$/.test(before)) return before;
    }
    return this.indentOf(object.start) + this.unit;
  }

  /**
   * Where a new line can begin, from an offset — past whatever else is already on that one.
   *
   * A `//` after a member is a note about THAT member: inserting in front of it would slide somebody's
   * sentence onto the new field, and putting the comma after it would put the comma inside a comment.
   * A block comment that runs on to the next line is not on this line at all, so it belongs to
   * whatever comes after and is left where it is.
   */
  private lineEnd(from: number): number {
    let at = from;
    for (;;) {
      let ahead = at;
      while (this.source[ahead] === " " || this.source[ahead] === "\t") ahead += 1;
      if (this.source[ahead] === "/" && this.source[ahead + 1] === "/") {
        while (ahead < this.source.length && this.source[ahead] !== "\n") ahead += 1;
        return ahead;
      }
      if (this.source[ahead] === "/" && this.source[ahead + 1] === "*") {
        const end = this.source.indexOf("*/", ahead + 2);
        if (end === -1 || this.source.slice(ahead, end).includes("\n")) return at;
        at = end + 2;
        continue;
      }
      return at;
    }
  }

  /** The start of the block of `//` lines directly above one, stopping at a blank line. */
  private commentsAbove(lineStart: number, floor: number): number {
    let at = lineStart;
    while (at > floor) {
      const above = this.source.lastIndexOf("\n", at - 2) + 1;
      if (above < floor) return at;
      if (!this.source.slice(above, at - 1).trim().startsWith("//")) return at;
      at = above;
    }
    return at;
  }

  /** Past a single character, if that is the next thing there is — otherwise where we started. */
  private past(from: number, char: string): number {
    let at = from;
    while (at < this.source.length && /\s/.test(this.source[at])) at += 1;
    return this.source[at] === char ? at + 1 : from;
  }
}

/**
 * The same merge, on the values rather than on the text.
 *
 * Here so it sits beside the one it has to agree with. The writer's whole safety net is comparing what
 * the spliced FILE now says against what this says it should say — two implementations of one rule,
 * one of which knows about offsets and comments and one of which does not. A splice that lands in the
 * wrong place, or drops a member, or writes a value twice, differs from this and is refused before it
 * reaches the disk.
 */
export function merged(base: unknown, fragment: unknown): unknown {
  if (!isBlock(base) || !isBlock(fragment)) return fragment;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(fragment)) out[key] = merged(base[key], value);
  return out;
}

/** A plain object — the one shape a merge goes INTO rather than over. An array is a value. */
export function isBlock(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * How long a written value may be before it is broken across lines.
 *
 * Wide enough that an ordinary step — a locator and a value — stays on one line, which is how every
 * step in front of me is written; narrow enough that a whole service does not arrive as one line
 * nobody can read a diff of.
 */
const WIDTH = 120;

type Edit = { start: number; end: number; text: string };

/**
 * Every splice, applied from the back, so the offsets in front of each one still mean what they did.
 *
 * Overlapping spans are refused rather than applied. Two edits over one comma is a defect this made
 * once — a removal on a single-line object cut the comma in its own span and then cut it again — and
 * what it produces is not an error but a file that no longer parses. Said here, where the two edits
 * are, rather than left to the reader of a corrupted description.
 */
function splice(source: string, edits: Edit[]): string {
  let out = source;
  let floor = source.length;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.end > floor) throw new Error(`two edits overlap at ${edit.start}..${edit.end}; this is a bug in witness`);
    floor = edit.start;
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

type ObjectNode = { kind: "object"; start: number; end: number; members: Member[] };
type Node = ObjectNode | { kind: "value"; start: number; end: number };
/** `start` is the opening quote of the key, which is where the member's own text begins. */
type Member = { key: string; start: number; value: Node };

/**
 * JSONC, as offsets.
 *
 * Only as much of a parser as an editor needs: objects, because a field is addressed through them,
 * and everything else as a span with a start and an end. An array's items are never addressed
 * individually — see the note on `Jsonc` about why a step list is replaced whole — so nothing is kept
 * about them beyond where they begin and end.
 */
function read(source: string): Node {
  let at = 0;

  const skip = (): void => {
    for (;;) {
      while (at < source.length && /\s/.test(source[at])) at += 1;
      if (source[at] === "/" && source[at + 1] === "/") {
        while (at < source.length && source[at] !== "\n") at += 1;
        continue;
      }
      if (source[at] === "/" && source[at + 1] === "*") {
        const end = source.indexOf("*/", at + 2);
        at = end === -1 ? source.length : end + 2;
        continue;
      }
      return;
    }
  };

  /** A quoted string, from its opening quote. A `\"` inside one is two characters, not the end of it. */
  const string = (): string => {
    const from = at;
    at += 1;
    while (at < source.length && source[at] !== '"') at += source[at] === "\\" ? 2 : 1;
    at += 1;
    return JSON.parse(source.slice(from, at)) as string;
  };

  const value = (): Node => {
    skip();
    const start = at;
    if (at >= source.length) throw new Error("the description ends where a value should be");

    if (source[at] === "{") {
      at += 1;
      const members: Member[] = [];
      for (;;) {
        skip();
        if (at >= source.length) throw new Error(`an object opened at character ${start} is never closed`);
        if (source[at] === "}") {
          at += 1;
          break;
        }
        if (source[at] === ",") {
          at += 1;
          continue;
        }
        if (source[at] !== '"') throw new Error(`character ${at}: a key must be a quoted string, and this is ${JSON.stringify(source[at])}`);
        const keyStart = at;
        const key = string();
        skip();
        if (source[at] !== ":") throw new Error(`character ${at}: "${key}" is not followed by a colon`);
        at += 1;
        members.push({ key, start: keyStart, value: value() });
      }
      return { kind: "object", start, end: at, members };
    }

    if (source[at] === "[") {
      at += 1;
      for (;;) {
        skip();
        if (at >= source.length) throw new Error(`an array opened at character ${start} is never closed`);
        if (source[at] === "]") {
          at += 1;
          break;
        }
        if (source[at] === ",") {
          at += 1;
          continue;
        }
        value();
      }
      return { kind: "value", start, end: at };
    }

    if (source[at] === '"') {
      string();
      return { kind: "value", start, end: at };
    }

    while (at < source.length && !/[\s,\]}]/.test(source[at])) at += 1;
    if (at === start) throw new Error(`character ${at}: ${JSON.stringify(source[at])} begins nothing`);
    return { kind: "value", start, end: at };
  };

  const root = value();
  skip();
  if (at < source.length) throw new Error(`character ${at}: ${JSON.stringify(source.slice(at, at + 20))} is past the end of the description`);
  return root;
}
