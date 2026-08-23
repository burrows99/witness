import * as path from "node:path";

import { playwright } from "../browser/playwright.ts";

/**
 * Where a run's artefacts go, decided by the run rather than by whoever typed it.
 *
 * Naming evidence by hand does not survive contact with a repo: slugs drift (`"546"` ends up shared by
 * seven runs, `"474-persistence"` and `"583"` describe the same kind of thing two ways), frames get
 * hand-numbered until two of them are `2-`, and the video lands in a third place named after whatever
 * directory something else happened to choose.
 *
 * So it is derived, from facts that already exist and are already unique: how the run was driven, what
 * was run, and which cut is being recorded. Same run, same paths — every time, without anyone choosing.
 *
 *     <artifacts>/cli/<the actions you ran>/<cut>/
 *       video.mp4
 *       frames/01-her-dashboard.png
 *       ops.createModule/01-click.png
 *       ops.createModule/debug.md
 *       manual-verification.md
 */
export type EvidenceContext = {
  /**
   * How the run was driven — `cli`, or the file it came from when something imported the library.
   *
   * It was called `spec` and, once there were no spec files, it held the literal `"cli"` for every
   * run there is: a field named after a thing that no longer exists, printed into a note as
   * "Spec: `cli`", which told a reader nothing and implied something false.
   */
  source: string;
  /** What was run, slugged — the chain of actions, or a test's title when one is driving. */
  test: string;
  /** Which cut this is: `EVIDENCE=before|after`, or `run` for an ordinary run. */
  cut: string;
  /** `<source>/<test>/<cut>` — the one directory everything about this run lands in. */
  group: string;
  /** Where this run's recordings are being written. */
  outputDir?: string;
};

/** Lower-case, dash-separated, no surprises — and short enough to read in a file listing. */
export function slug(value: string, max = 48): string {
  const cleaned = value
    .normalize("NFKD")
    // The accents NFKD just separated out, removed rather than turned into a word break: otherwise
    // "résumé" files itself as "re-sume".
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned.length <= max) return cleaned || "unnamed";
  // Truncated at a word boundary rather than mid-word, and deterministically: no hash, no counter.
  const cut = cleaned.slice(0, max);
  return cut.slice(0, cut.lastIndexOf("-") > max / 2 ? cut.lastIndexOf("-") : max);
}

/**
 * The context of whatever is running now.
 *
 * The command line pins one before it starts. This is the fallback for the other case — something
 * importing the library into a runner of its own — and, failing that, it says `cli/adhoc` rather than
 * inventing a name.
 */
export function currentContext(fallbackLabel = "cli"): EvidenceContext {
  const info = safeInfo();
  const cut = process.env.EVIDENCE ?? "run";
  if (!info) {
    return { source: fallbackLabel, test: "adhoc", cut, group: path.join(fallbackLabel, "adhoc", cut) };
  }
  const source = slug(path.basename(info.file).replace(/\.(spec|test)\.ts$/, ""), 64);
  const title = slug(info.titlePath.slice(1).join(" ") || info.title);
  return { source, test: title, cut, group: path.join(source, title, cut), outputDir: info.outputDir };
}

/** `test.info()` throws outside a test; a system that can also be driven from a shell must cope. */
export function safeInfo(): TestInfo | undefined {
  try {
    return playwright()?.test.info();
  } catch {
    return undefined;
  }
}

type TestInfo = ReturnType<NonNullable<ReturnType<typeof playwright>>["test"]["info"]>;
