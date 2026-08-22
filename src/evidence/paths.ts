import * as path from "node:path";

import { playwright } from "../browser/playwright.ts";

/**
 * Where a run's artefacts go, decided by the run rather than by whoever typed the spec.
 *
 * Naming evidence by hand does not survive contact with a repo: slugs drift (`"546"` ends up shared by
 * seven specs, `"474-persistence"` and `"583"` describe the same kind of thing two ways), frames get
 * hand-numbered until two of them are `2-`, and the video lands in a third place named after whatever
 * the test runner called its output directory.
 *
 * So it is derived, from facts that already exist and are already unique: which spec, which test in it,
 * and which cut is being recorded. Same run, same paths — every time, and without anyone choosing.
 *
 *     <artifacts>/<spec>/<test>/<cut>/
 *       video.mp4
 *       frames/01-her-dashboard.png
 *       actions/ops.createModule/01-click.png
 *       manual-verification.md
 *       trace.json
 */
export type EvidenceContext = {
  /** The spec file, without its extension — `back-to-dashboard-583`. */
  spec: string;
  /** The test's own title, slugged. */
  test: string;
  /** Which cut this is: `EVIDENCE=before|after`, or `run` for an ordinary run. */
  cut: string;
  /** `<spec>/<test>/<cut>` — the one directory everything about this test lands in. */
  group: string;
  /** Where the runner is writing this test's recordings, if we are inside a test. */
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
 * Inside a test that is the test itself. Outside one — the CLI running an action, say — there is no spec
 * and no title, so it says so rather than inventing a name: `cli/<label>/…`.
 */
export function currentContext(fallbackLabel = "cli"): EvidenceContext {
  const info = safeInfo();
  const cut = process.env.EVIDENCE ?? "run";
  if (!info) {
    return { spec: fallbackLabel, test: "adhoc", cut, group: path.join(fallbackLabel, "adhoc", cut) };
  }
  const spec = slug(path.basename(info.file).replace(/\.(spec|test)\.ts$/, ""), 64);
  const title = slug(info.titlePath.slice(1).join(" ") || info.title);
  return { spec, test: title, cut, group: path.join(spec, title, cut), outputDir: info.outputDir };
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
