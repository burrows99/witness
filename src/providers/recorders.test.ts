import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { asTape, recorderProviders } from "./recorders.ts";
import type { StepConfig } from "../actions/engine.ts";

const tape = (steps: StepConfig[], opts = {}) => asTape(steps, {}, "/tmp/out.mp4", opts).split("\n");

test("an action becomes a tape, which is why this recorder and not another", () => {
  // A `.tape` IS a step list. asciinema records a real session into its own cast format and needs a
  // second tool to become a video; this needs no second language and writes MP4 directly.
  const lines = tape([
    { type: { on: "prompt", value: "psql -c 'select 1'" } },
    { press: "Enter" },
    { wait: 1500 },
  ]);
  ok(lines.includes(`Type "psql -c 'select 1'"`));
  ok(lines.includes("Enter"));
  ok(lines.includes("Sleep 1500ms"));
});

test("an expectation becomes a wait, which is the same claim a screen makes", () => {
  const lines = tape([{ expect: { on: "x", text: "1 row" } }]);
  ok(lines.some(l => l.startsWith("Wait+Screen /1 row/")), lines.join(" | "));
});

test("what has no meaning without a screen is skipped, not approximated", () => {
  // A recording that invented an interaction would be worse than one missing it.
  const lines = tape([{ click: { role: "button", name: "Save" } }, { press: "Enter" }]);
  ok(!lines.some(l => l.includes("Save")), lines.join(" | "));
  ok(lines.includes("Enter"));
});

test("a pane says who it is before anything happens in it", () => {
  // A terminal cannot be handed a header the way a page can.
  const lines = tape([{ press: "Enter" }], { label: { title: "shell.readTheDatabase", sub: "the database, from a prompt" } });
  match(lines[7] ?? "", /# shell\.readTheDatabase — the database, from a prompt/);
});

test("the shell it runs inside is typed first", () => {
  const lines = tape([{ press: "Enter" }], { shell: "docker exec -it db bash" });
  ok(lines.includes('Type "docker exec -it db bash"'));
});

test("the pane is the same size as a browser one, so the two stitch", () => {
  // A terminal recording that came out a different shape would be letterboxed beside a screen.
  const lines = tape([]);
  ok(lines.includes("Set Width 1280"));
  ok(lines.includes("Set Height 900"));
});

test("a value with a double quote in it still makes a valid tape", () => {
  // A tape has no escape for one inside a quoted string, and Gitea's own table is `"user"`.
  const lines = tape([{ type: { on: "prompt", value: 'select * from "user"' } }]);
  ok(lines.some(l => l === 'Type `select * from "user"`'), lines.join(" | "));
});

test("a value with a backslash in it takes a delimiter that does not escape one", () => {
  // Not `"…"`: a tape has no escapes inside one, so `JSON.stringify` doubling the backslash is typed
  // as two characters. The tape looked right, which is why this went unnoticed — the assertion that
  // matters is the one below, on what the shell got.
  const lines = tape([{ type: { on: "prompt", value: "tr '\\n' ' '" } }]);
  ok(lines.some(l => l === "Type `tr '\\n' ' '`"), lines.join(" | "));
});

test("text that uses every quote character is refused rather than mangled", () => {
  // The backtick fallback used to rewrite a backtick as an apostrophe — the same defect as the
  // doubled backslash, one layer down. There is no fourth delimiter, so this is the honest answer.
  throws(() => tape([{ type: { on: "prompt", value: `echo "it's \`date\`"` } }]), /every quote character/);
});

test("what the tape types is what the shell receives", { skip: recorderProviders.get("terminal").available() ? false : "needs vhs on the path" }, () => {
  // The only assertion that can catch this class of bug. A test reading the TAPE passes against the
  // defect it is meant to catch: the tape said `\\n` and looked correct, and the shell got two
  // characters where the description asked for one — so every letter `n` in the recorded output
  // became a space, on a frame whose whole job was a comparison with `docker ps`.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "witness-tape-"));
  const got = path.join(dir, "typed.txt");
  // Both halves of it: `\n` is an escape a recorder must not touch, and `{{.Names}}` is a brace pair
  // that was never a parameter. `printf %s` writes back exactly what the shell parsed.
  const asked = "tr \\n --format {{.Names}}";
  try {
    recorderProviders
      .get("terminal")
      .record([{ type: { on: "prompt", value: `printf %s '${asked}' > ${got}` } }, { press: "Enter" }, { wait: 1500 }], {}, path.join(dir, "out.mp4"), {});
    equal(fs.existsSync(got) ? fs.readFileSync(got, "utf8") : "<the command never ran>", asked);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unregistered recorder names the ones that exist", () => {
  try {
    recorderProviders.get("smoke-signals");
    ok(false, "should have refused");
  } catch (err) {
    match(String(err), /no recorder provider "smoke-signals" — registered: terminal/);
  }
});

test("it says whether this machine can record at all", () => {
  equal(typeof recorderProviders.get("terminal").available(), "boolean");
  deepEqual(recorderProviders.names, ["terminal"]);
});

test("the only recorder names offered are ones that resolve", () => {
  // `records: "browser"` was in the type and never in the registry: `get("browser")` threw, and the
  // code only ever branched on "terminal". A type offering a value nothing can serve is a lie in the
  // one place a reader trusts.
  for (const name of recorderProviders.names) ok(recorderProviders.get(name), name);
  deepEqual(recorderProviders.names, ["terminal"]);
});
