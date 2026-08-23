import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { fill } from "../config/index.ts";
import { Registry } from "./registry.ts";
import type { Params, StepConfig } from "../actions/engine.ts";

/**
 * What captures a service while it runs.
 *
 * The first half of two. A RECORDER films something as it happens; `video` (see `video.ts`) takes
 * whatever was filmed and makes one watchable file out of it — stitching panes into a grid, splicing
 * the slide cards. ffmpeg cannot drive a browser and VHS cannot stitch panes, which is why they are
 * two registries and not one.
 *
 * A browser is not in here: the runner drives one itself, because recording it is inseparable from the
 * context, the identities and the trace that surround it. This registry is for what a browser is the
 * wrong tool for.
 *
 * Playwright records a browser, which is most of a product and not all of it: a stack usually has
 * something with no screen — a migration, a queue worker, a `psql` somebody actually types. Recording
 * those with a browser is not a limitation to work around, it is the wrong tool, and the answer is the
 * same one this codebase gives everywhere else: name the recorder in the description.
 *
 * A terminal recording is a video of the same shape as a browser one, so it stitches into the same
 * grid — a screen and a shell side by side, which is what half of "did it work" actually looks like.
 */
export type Recorder = {
  /** Whether this machine can do it at all. */
  available: () => boolean;
  /** Drive the steps, and leave a video at `out`. Returns what it wrote, or nothing. */
  record: (steps: StepConfig[], values: Params, out: string, opts: RecorderOptions) => string | undefined;
};

export type RecorderOptions = {
  /** Matched to a browser pane, so the two stitch together without either being letterboxed. */
  width?: number;
  height?: number;
  fontSize?: number;
  /** What every command runs inside, when the CLI lives in a container: `docker exec -it <name>`. */
  shell?: string;
  /** Who this pane is. A terminal cannot be given a header the way a page can, so the tape says it. */
  label?: { title: string; sub?: string };
};

export const recorderProviders = new Registry<Recorder>("recorder")
  /**
   * A terminal, through VHS.
   *
   * Chosen over asciinema because a `.tape` IS a step list — `Type`, `Enter`, `Sleep`, `Wait` — so an
   * action becomes one without inventing a second language for the half of a product that has no
   * screen. It also writes MP4 directly, which is the shape the stitcher already takes; asciinema
   * writes its own cast format and needs a second tool to become a video.
   */
  .register("terminal", {
    available: () => {
      try {
        execFileSync("vhs", ["--version"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    record: (steps, values, out, opts) => {
      const tape = path.join(path.dirname(out), `${path.basename(out, path.extname(out))}.tape`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(tape, asTape(steps, values, out, opts));
      try {
        execFileSync("vhs", [tape], { stdio: "ignore" });
        return fs.existsSync(out) ? out : undefined;
      } catch {
        // A recorder that cannot record must not fail the run it was recording.
        process.stderr.write(`[terminal] vhs could not record ${path.basename(out)}\n`);
        return undefined;
      }
    },
  });

/**
 * The same steps, as a tape.
 *
 * Only the verbs that mean something without a screen. A `click` has no terminal equivalent and is
 * skipped rather than approximated — a recording that quietly invented an interaction would be worse
 * than one that is missing it.
 */
export function asTape(steps: StepConfig[], values: Params, out: string, opts: RecorderOptions = {}): string {
  const { width = 1280, height = 900, fontSize = 20, shell, label } = opts;
  const text = (value: string): string => fill(value, values);
  const lines = [
    `Output ${JSON.stringify(out)}`,
    `Set Width ${width}`,
    `Set Height ${height}`,
    `Set FontSize ${fontSize}`,
    "Set Padding 14",
    'Set Theme "Catppuccin Mocha"',
    // Long enough that a command's output is readable, short enough that a pane is not mostly idle.
    "Set TypingSpeed 40ms",
  ];
  // Named first, so a pane in a grid says what it is before anything happens in it.
  if (label) lines.push(`Type ${quote(`# ${label.title}${label.sub ? ` — ${label.sub}` : ""}`)}`, "Enter", "Sleep 700ms");
  if (shell) lines.push(`Type ${quote(text(shell))}`, "Enter", "Sleep 1s");

  for (const step of steps) {
    if (step.type) lines.push(`Type ${quote(text(step.type.value))}`);
    // A shell's `press` is almost always this one, and `Enter` is its own command in a tape.
    if (step.press) lines.push(step.press === "Enter" ? "Enter" : `Type ${quote(step.press)}`);
    if (step.wait) lines.push(`Sleep ${step.wait}ms`);
    // `expect` becomes a WAIT: the tape holds until the text appears, which is the same claim the
    // browser makes — and it fails the recording if it never does.
    if (step.expect?.text) lines.push(`Wait+Screen /${escapeRegex(text(step.expect.text))}/`);
    if (step.caption) lines.push(`Type ${quote(`# ${text(step.caption.text)}`)}`, "Enter");
  }
  lines.push("Sleep 2s");
  return lines.join("\n") + "\n";
}

/** A tape has no escape for a double quote inside one, so a backtick string is used where needed. */
function quote(value: string): string {
  return value.includes('"') ? `\`${value.replace(/`/g, "'")}\`` : JSON.stringify(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
