import { deepEqual, equal, match, ok } from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Evidence } from "./evidence.ts";
import type { EvidenceContext } from "./paths.ts";

// This file was committed empty. `node --test` globbed it, found no tests, and reported green — a
// name promising coverage that did not exist, in the module whose whole job is not lying about what
// it holds. These are the claims the rest of the system makes about it.

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function workspace(): { root: string; evidence: (group?: string) => Evidence; context: EvidenceContext } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "witness-evidence-"));
  roots.push(root);
  const outputDir = path.join(root, "test-results", "a-test");
  const context: EvidenceContext = { source: "cli", test: "b", cut: "run", group: path.join("cli", "b", "run"), outputDir };
  return { root, context, evidence: (group = context.group) => new Evidence({ root, context: { ...context, group } }) };
}

test("everything about one run lands in one directory, named for the run", () => {
  const { root, evidence, context } = workspace();
  equal(evidence().dir, path.join(root, "artifacts", context.group));
});

test("a written file keeps the grouping its name expressed", () => {
  const { evidence } = workspace();
  const file = evidence().write("actions/sign-in/debug.md", "# what happened");
  match(file, /actions\/sign-in\/debug\.md$/);
  equal(fs.readFileSync(file, "utf8"), "# what happened");
});

test("a name that is already a filename is not slugged into a different one", () => {
  const { evidence } = workspace();
  // `slug` lower-cases, which quietly renamed the one file in the directory whose name is a
  // convention — and every doc that told a reader to open `README.md` was wrong about it.
  match(evidence().write("README.md", "# what this run left behind"), /\/README\.md$/);
  match(evidence().write("her dashboard.md", "#"), /\/her-dashboard\.md$/);
});

test("a stale file from the run before is not left sitting in the evidence", () => {
  const { evidence } = workspace();
  const first = evidence();
  const before = first.write("actions/sign-in/debug.md", "the run before");
  // A system hands out a NEW Evidence per call, and each of them must agree that this directory was
  // already emptied — the bug this replaces deleted the frames it had just taken.
  const second = evidence();
  const after = second.write("actions/sign-in/debug.md", "this run");
  equal(before, after);
  equal(fs.readFileSync(after, "utf8"), "this run");
});

test("the manifest says which directory this test's evidence went to", () => {
  const { root, evidence, context } = workspace();
  evidence().writeManifest();
  const manifest = JSON.parse(fs.readFileSync(path.join(context.outputDir!, "evidence.json"), "utf8")) as { dir: string };
  // This is the one line a reporter reads to find the story: it must be the real directory.
  equal(manifest.dir, path.join(root, "artifacts", context.group));
});

test("the artefacts are named where they land, not where they already are", () => {
  const { evidence, context } = workspace();
  const artefacts = evidence().artefacts();
  // A story is written mid-run, when the video has not been rendered and the trace has not been
  // written. Naming only what exists yet would leave both out of every story.
  equal(artefacts.video, path.join(evidence().dir, "video.mp4"));
  equal(artefacts.frames, path.join(evidence().dir, "frames"));
  equal(artefacts.trace, path.join(context.outputDir!, "trace.zip"));
  equal(artefacts.har, undefined);
});

test("stories are every write-up the run produced, however deep", () => {
  const { evidence } = workspace();
  const one = evidence();
  one.write("actions/sign-in/debug.md", "#");
  one.write("actions/sign-in/debug.json", "{}");
  one.write("actions/browse/debug.md", "#");
  one.write("notes.md", "not a story");
  const found = one.stories();
  equal(found.length, 3);
  ok(found.every(file => /debug\.(md|json)$/.test(file)));
});

test("a test that drove nothing has no stories rather than an error", () => {
  const { evidence } = workspace();
  equal(evidence("never/written/run").stories().length, 0);
});

test("frames are numbered across the whole run, not per object", async () => {
  const { evidence } = workspace();
  const page = { screenshot: async ({ path: file }: { path: string }) => fs.writeFileSync(file, "") } as never;
  // A system builds a NEW Evidence for every call. Counting per-instance named eight stills taken in
  // order `01-` — a directory where everything claims to be first is worse than one with no numbers.
  const files = [];
  for (const name of ["signed in", "dashboards", "explore"]) files.push(await evidence().frame(page, name));
  deepEqual(
    files.map(file => path.basename(file)),
    ["01-signed-in.png", "02-dashboards.png", "03-explore.png"],
  );
});

test("clearing does not delete evidence an action already wrote inside itself", async () => {
  // An action's own frames arrive AFTER the actions it composed have written theirs inside it. Wiping
  // the parent for its first frame took the child with it, and the story then pointed at a path that
  // was not there.
  const { evidence } = workspace();
  const page = { screenshot: async ({ path: file }: { path: string }) => fs.writeFileSync(file, "") } as never;
  const child = evidence().write("tour/02-signin/debug.md", "what the composed action did");
  await evidence().frame(page, "and then the parent took one");
  await evidence().actionFrame(page, "tour", 3, "frame");
  ok(fs.existsSync(child), "the composed action's story survived the parent's first frame");
});

test("but the run before is still cleared, once", () => {
  const { evidence } = workspace();
  const stale = evidence().write("tour/02-signin/debug.md", "the run before");
  // A second Evidence for the same run must NOT clear again — that was the bug this replaced.
  const fresh = evidence().write("tour/02-signin/debug.md", "this run");
  equal(stale, fresh);
  equal(fs.readFileSync(fresh, "utf8"), "this run");
});
