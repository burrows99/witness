import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";

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
