import { deepEqual, equal, match, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { fallbackGroup, gridFilter, videoProviders } from "./video.ts";
import { writeCatalogue } from "../evidence/catalogue.ts";

/** How many panels the filter actually stacks, and where each one starts. */
const layoutOf = (filter: string): { inputs: number; cells: string[]; scale: string } => {
  const stack = /xstack=inputs=(\d+):layout=([^:]+):/.exec(filter)!;
  return { inputs: Number(stack[1]), cells: stack[2].split("|"), scale: /scale=(\d+):-2/.exec(filter)![1] };
};

test("one panel per recording — a form that stitches the first two would drop the rest", () => {
  // The exact failure this kind of evidence exists to catch: a panel silently missing from a comparison.
  for (const n of [2, 3, 4, 5, 6]) equal(layoutOf(gridFilter(n)).inputs, n);
});

test("two or three go side by side; four or more go into a grid", () => {
  // A reviewer sees the video about 800px wide, so four in a row leaves 200px each and the comparison —
  // which IS the claim — stops being readable.
  deepEqual(layoutOf(gridFilter(2)).cells, ["0_0", "w0_0"]);
  deepEqual(layoutOf(gridFilter(3)).cells, ["0_0", "w0_0", "w0+w0_0"]);
  deepEqual(layoutOf(gridFilter(4)).cells, ["0_0", "w0_0", "0_h0", "w0_h0"]);
  deepEqual(layoutOf(gridFilter(5)).cells, ["0_0", "w0_0", "0_h0", "w0_h0", "0_h0+h0"]);
});

test("the frame is as wide as the panels it holds", () => {
  equal(layoutOf(gridFilter(2)).scale, "1920");
  equal(layoutOf(gridFilter(3)).scale, "2880");
  // Four in two columns is as wide as two, not as wide as four.
  equal(layoutOf(gridFilter(4)).scale, "1920");
  equal(layoutOf(gridFilter(4, { panelWidth: 640 })).scale, "1280");
});

test("a config can say how many columns it wants", () => {
  deepEqual(layoutOf(gridFilter(4, { columns: 4 })).cells, ["0_0", "w0_0", "w0+w0_0", "w0+w0+w0_0"]);
  deepEqual(layoutOf(gridFilter(4, { columns: "auto" })).cells, layoutOf(gridFilter(4)).cells);
});

test("every panel is inset, so the seam between two reads as a divider", () => {
  const filter = gridFilter(2, { border: "0xff0000" });
  equal(filter.match(/pad=iw\+4:ih\+4:2:2:color=0xff0000/g)?.length, 2);
  match(gridFilter(2, { fill: "0x000000" }), /fill=0x000000/);
});

test("a recording with no manifest keeps the runner's own name, plainly", () => {
  // Not thrown away, but not pretending to know which test it belongs to either.
  equal(fallbackGroup("spec-name-9f3a1b2c4d-a-test-title"), path.join("unattributed", "spec-name-a-test-title"));
});

test("the index lists what is on disk, not what this run happened to produce", () => {
  // The question anyone actually has is "where is the before cut of the thing I changed" — and the
  // before cut was recorded by a different run.
  const out = mkdtempSync(path.join(tmpdir(), "witness-video-"));
  const evidence = (spec: string, name: string, cut: string, files: string[]): void => {
    const dir = path.join(out, spec, name, cut);
    mkdirSync(path.join(dir, "frames"), { recursive: true });
    for (const file of files) writeFileSync(path.join(dir, file), "");
  };
  evidence("orders-583", "a-customer-cancels", "before", ["video.mp4"]);
  evidence("orders-583", "a-customer-cancels", "after", ["video.mp4", "manual-verification.md"]);
  writeFileSync(path.join(out, "orders-583", "a-customer-cancels", "after", "frames", "01-dashboard.png"), "");
  evidence("signup-474", "a-member-signs-up", "run", []);

  writeCatalogue(out);

  const index = readFileSync(path.join(out, "index.md"), "utf8");
  match(index, /## orders-583/);
  match(index, /\*\*after\*\* · a-customer-cancels — \[video\]/);
  match(index, /1 frame/);
  match(index, /how to check by hand/);
  match(index, /\*\*before\*\* · a-customer-cancels/);
  // A directory with frames but no video is still evidence.
  match(index, /\*\*run\*\* · a-member-signs-up — no video/);
  ok(index.indexOf("## orders-583") < index.indexOf("## signup-474"), "specs are listed in a stable order");
});

test("the video provider is registered under the name a config uses", () => {
  deepEqual(videoProviders.names, ["ffmpeg"]);
  equal(typeof videoProviders.get("ffmpeg").available, "function");
});

const ffmpegHere = videoProviders.get("ffmpeg").available();

/** A run's raw recording, with the manifest saying which cut directory it belongs to. */
const recorded = (from: string, dir: string, into: string): string => {
  const at = path.join(from, dir);
  mkdirSync(at, { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=8:duration=0.5", path.join(at, "panel-01-01.mp4")]);
  writeFileSync(path.join(at, "evidence.json"), JSON.stringify({ source: "cli", test: dir, cut: "before", group: dir, dir: into }));
  return path.join(into, "video.mp4");
};

test("a run renders what it recorded and leaves every other cut alone", { skip: ffmpegHere ? false : "needs ffmpeg" }, () => {
  // The evidence model rests on a `before` being a record of the code as it WAS. This swept every
  // directory still sitting under `test-results`, so running one action re-rendered another action's
  // `before/video.mp4` and its still — a before silently regenerated AFTER the change, with nothing
  // saying so. It is "a stale after looks like evidence without being any", arriving from the other
  // direction, and it defeats the one rule `require-before-after.sh` deliberately does not check.
  const root = mkdtempSync(path.join(tmpdir(), "witness-video-"));
  const from = path.join(root, "artifacts", "test-results");
  const alpha = recorded(from, "cli-alpha", path.join(root, "artifacts", "cli", "alpha", "before"));
  const beta = recorded(from, "cli-beta", path.join(root, "artifacts", "cli", "beta", "before"));

  deepEqual(videoProviders.get("ffmpeg").render({}, root).sort(), [alpha, beta].sort());
  const untouched = statSync(beta).mtimeMs;

  // A second run records alpha again, and only alpha.
  const later = Date.now() / 1000 + 2;
  utimesSync(path.join(from, "cli-alpha", "panel-01-01.mp4"), later, later);

  deepEqual(videoProviders.get("ffmpeg").render({}, root), [alpha]);
  equal(statSync(beta).mtimeMs, untouched, "beta's before cut was rewritten by a run that did not record it");
});

test("`witness video` rebuilds, because that is the word in its summary", { skip: ffmpegHere ? false : "needs ffmpeg" }, () => {
  // The skip above must not silently turn the one command asked for by name into a no-op.
  const root = mkdtempSync(path.join(tmpdir(), "witness-video-"));
  const from = path.join(root, "artifacts", "test-results");
  const only = recorded(from, "cli-alpha", path.join(root, "artifacts", "cli", "alpha", "before"));

  deepEqual(videoProviders.get("ffmpeg").render({}, root), [only]);
  deepEqual(videoProviders.get("ffmpeg").render({}, root), [], "a second run has nothing new to say");
  deepEqual(videoProviders.get("ffmpeg").render({}, root, { force: true }), [only]);
});
