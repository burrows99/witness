import * as fs from "node:fs";
import * as path from "node:path";

import type { Page } from "@playwright/test";

import { currentContext, type EvidenceContext, slug } from "./paths.ts";

/**
 * What a run leaves behind besides its video: stills, files, and a note a person can follow.
 *
 * Everything about one test lands in ONE directory, named for the test rather than by hand:
 *
 *     artifacts/<spec>/<test>/<cut>/
 *       video.mp4                       the recording, put here by the video provider
 *       frames/01-her-dashboard.png     stills, numbered in the order they were taken
 *       actions/<action>/01-click.png   a frame per step of each action the test ran
 *       manual-verification.md          how to re-walk it by hand
 *
 * `cut` is `EVIDENCE=before|after` (or `run`), so the two halves of a before/after cannot overwrite
 * each other and sit side by side for comparison. Frames are numbered here rather than in the caller,
 * because hand-numbering is how a spec ends up with two `2-` and one of them lost.
 */
export class Evidence {
  readonly mode: string;
  readonly keep: boolean;

  private readonly root: string;
  private readonly base: string;
  private readonly links: () => string[];
  private readonly pinned?: EvidenceContext;
  /** Frames are numbered per test, not per object: specs build one of these at module load. */
  private readonly counters = new Map<string, number>();

  constructor(opts: { root: string; base?: string; links?: () => string[]; context?: EvidenceContext }) {
    this.root = opts.root;
    this.base = opts.base ?? "artifacts";
    this.links = opts.links ?? (() => []);
    this.pinned = opts.context;
    this.mode = process.env.EVIDENCE ?? "run";
    this.keep = process.env.KEEP === "1";
  }

  /**
   * Which test is asking, resolved NOW rather than at construction.
   *
   * Specs build their `evidence` at the top of the file, which runs at import time — before any test
   * exists. Resolving eagerly there put every frame under `cli/adhoc`, which is exactly the kind of
   * quietly-wrong filing this scheme is meant to end.
   */
  get context(): EvidenceContext {
    return this.pinned ?? currentContext();
  }

  /** The one directory everything about the running test goes in. */
  get dir(): string {
    return path.join(this.root, this.base, this.context.group);
  }

  /**
   * A still, numbered in the order it was taken: `frames/03-her-dashboard.png`.
   *
   * `fullPage` captures below the fold — right for a long screen whose point is further down, wrong for
   * anything where the viewport IS the claim (a ticket that names a device size, a sticky element).
   */
  async frame(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<string> {
    const context = this.context;
    this.writeManifest(context);
    const next = (this.counters.get(context.group) ?? 0) + 1;
    this.counters.set(context.group, next);
    const file = path.join(this.dir, "frames", `${String(next).padStart(2, "0")}-${slug(name)}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
    return file;
  }

  /** A frame belonging to an action, kept with the action that took it. */
  async actionFrame(page: Page, action: string, index: number, name: string): Promise<string> {
    this.writeManifest();
    const file = path.join(this.dir, "actions", slug(action, 64), `${String(index).padStart(2, "0")}-${slug(name)}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    return file;
  }

  /** Any other artefact — a payload, a log, a note the spec wrote as it went. */
  write(name: string, contents: string): string {
    this.writeManifest();
    // Each segment slugged on its own: slugging the whole thing turns `actions/x/debug.md` into one
    // flat `actions-x-debug.md`, which loses the grouping the name was expressing.
    const parts = name.split("/").filter(Boolean);
    const last = parts.pop() ?? "file";
    const extension = last.match(/\.\w+$/)?.[0] ?? "";
    const file = path.join(this.dir, ...parts.map(part => slug(part, 64)), slug(last.replace(/\.\w+$/, ""), 64) + extension);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  }

  /**
   * The note a person needs to re-walk this by hand.
   *
   * `subject` names whoever the run was about (an account, a tenant, a record) and `sections` carries
   * whatever is specific to this scenario. The generic half — which cut this was, who it was about,
   * where the apps are — is written here so every note reads the same way.
   */
  manualVerification(opts: {
    title: string;
    subject?: Record<string, string | undefined>;
    /** How to become the subject — a command that mints a session, say. */
    signIn?: string[];
    sections?: string[];
    notes?: string[];
  }): string {
    const { title, subject = {}, signIn = [], sections = [], notes = [] } = opts;
    const lines = [
      `# ${title} — manual verification (${this.mode}${this.keep ? ", data kept" : ", data torn down"})`,
      "",
      `Spec: \`${this.context.spec}\` · test: \`${this.context.test}\``,
      "",
      this.keep
        ? "The run left everything in place. The links below are live."
        : "The run tore its data down (`KEEP=1` keeps it). The links are recorded so a kept run can be compared.",
      "",
      ...(Object.keys(subject).length
        ? ["## Who", "", ...Object.entries(subject).filter(([, v]) => v).map(([k, v]) => `- ${k}: \`${v}\``), ""]
        : []),
      ...(signIn.length ? ["## Sign in as them", "", "```bash", ...signIn, "```", ""] : []),
      "## Where to look",
      "",
      ...this.links(),
      ...sections,
      ...(notes.length ? ["", "## What the run saw", "", ...notes.map(n => `- ${n}`)] : []),
      "",
    ];
    return this.write("manual-verification.md", lines.join("\n"));
  }

  /** Every write-up this test produced, for a reporter to attach. */
  stories(): string[] {
    const found: string[] = [];
    const walk = (at: string): void => {
      for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
        const file = path.join(at, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/^debug\.(md|json)$/.test(entry.name)) found.push(file);
      }
    };
    try {
      walk(this.dir);
    } catch {
      // Nothing written is not a failure: a test can pass without driving a single action.
    }
    return found.sort();
  }

  /**
   * The files a person opens, for a story to point at rather than replace.
   *
   * Playwright's own artefacts — the trace and the video — are better than anything written here could
   * be, and they are already on disk. What is missing is a reader that knows where they are.
   */
  artefacts(): { video?: string; frames?: string; trace?: string; har?: string } {
    const output = this.context.outputDir;
    const found = (at: string | undefined): string | undefined => (at && fs.existsSync(at) ? at : undefined);
    return {
      video: found(path.join(this.dir, "video.mp4")),
      frames: found(path.join(this.dir, "frames")),
      // The runner writes the trace when the TEST ends, which is after every action in it has run — so
      // this names where it will be rather than checking for a file that cannot exist yet.
      trace: output ? path.join(output, "trace.zip") : undefined,
      har: output ? found(path.join(output, "network.har")) : undefined,
    };
  }

  /**
   * Tell the video provider where this test's recording belongs.
   *
   * Written into the runner's own output directory — the one place that is unambiguously this test's —
   * so nothing downstream has to parse a directory name the runner mangled to fit a filesystem.
   */
  writeManifest(context: EvidenceContext = this.context): void {
    if (!context.outputDir) return;
    try {
      fs.mkdirSync(context.outputDir, { recursive: true });
      fs.writeFileSync(
        path.join(context.outputDir, "evidence.json"),
        JSON.stringify({ ...context, dir: path.join(this.root, this.base, context.group) }, null, 2),
      );
    } catch {
      // A manifest is a convenience: without it the video provider files the recording under what it
      // can read off the directory name.
    }
  }
}
