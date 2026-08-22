import { equal, match, ok } from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import Reporter from "./reporter.ts";

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A finished run on disk: an evidence directory, a manifest pointing at it, and some stories. */
function run(stories: Record<string, boolean>): { outputDir: string; dir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "witness-reporter-"));
  roots.push(root);
  const dir = path.join(root, "artifacts", "spec", "test", "run");
  const outputDir = path.join(root, "test-results", "spec-test");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "evidence.json"), JSON.stringify({ dir }));
  for (const [name, ok] of Object.entries(stories)) {
    const at = path.join(dir, "actions", name);
    fs.mkdirSync(at, { recursive: true });
    fs.writeFileSync(path.join(at, "debug.md"), `# ${name} — ${ok ? "ok" : "failed"}`);
    fs.writeFileSync(path.join(at, "debug.json"), JSON.stringify({ name, ok }));
  }
  return { outputDir, dir };
}

function printed(reporter: Reporter): string {
  const write = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as { write: unknown }).write = (chunk: string): boolean => ((out += chunk), true);
  try {
    reporter.onEnd();
  } finally {
    (process.stdout as { write: unknown }).write = write;
  }
  return out;
}

test("a passing run says nothing at all", () => {
  const reporter = new Reporter();
  const { outputDir } = run({ "sign-in": true });
  reporter.onTestEnd({ title: "a test" }, { status: "passed", outputDir });
  equal(printed(reporter), "");
});

test("only the action that broke is named", () => {
  const reporter = new Reporter();
  const { outputDir } = run({ "sign-in": true, "browse-connections": false, "open-explore": true });
  reporter.onTestEnd({ title: "a test" }, { status: "failed", outputDir });
  const out = printed(reporter);
  // Six actions where one broke printed all six under a heading promising the failing ones: the
  // story that mattered was one path in a list and nothing said which.
  match(out, /browse-connections\/debug\.md/);
  ok(!out.includes("sign-in/debug.md"));
  ok(!out.includes("open-explore/debug.md"));
});

test("when every action finished, it says the failure was in the spec", () => {
  const reporter = new Reporter();
  const { outputDir } = run({ "sign-in": true, "open-explore": true });
  reporter.onTestEnd({ title: "a test" }, { status: "failed", outputDir });
  const out = printed(reporter);
  match(out, /every action finished/);
  match(out, /sign-in\/debug\.md/);
  match(out, /open-explore\/debug\.md/);
});

test("a failure before any action ran points at the frames", () => {
  const reporter = new Reporter();
  const { outputDir, dir } = run({});
  reporter.onTestEnd({ title: "a test" }, { status: "failed", outputDir });
  match(printed(reporter), new RegExp(`${path.join(dir, "frames").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("the manifest is found from an attachment when the runner gives no output directory", () => {
  const reporter = new Reporter();
  const { outputDir } = run({ "browse-connections": false });
  reporter.onTestEnd({ title: "a test" }, { status: "failed", attachments: [{ path: path.join(outputDir, "trace.zip") }] });
  match(printed(reporter), /browse-connections\/debug\.md/);
});

test("a run with no manifest anywhere is quiet rather than wrong", () => {
  const reporter = new Reporter();
  reporter.onTestEnd({ title: "a test" }, { status: "failed", outputDir: os.tmpdir() });
  equal(printed(reporter), "");
});
