import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The last line a failing run prints: where to read what happened.
 *
 * A runner prints the error, then a wall of attachment paths, then its summary. The story a person was
 * told to read — the one with the network and the console tied to the step that failed — is either
 * unmentioned or twenty lines above the fold, and anyone piping to `tail` sees filenames instead of the
 * failure. A global teardown cannot fix that either: it runs before the reporter's summary.
 *
 * So this is a reporter, which is the runner's own way of saying something last:
 *
 * ```ts
 * reporter: [["list"], ["@burrows99/witness/reporter"]]
 * ```
 *
 * It reports nothing about the tests themselves — the reporter beside it does that — and prints
 * nothing at all when everything passed.
 */
export default class WitnessReporter {
  private readonly failures: string[] = [];
  /** Stories from a failing test where no single action broke: the run, not the breakage. */
  private readonly context: string[] = [];

  onTestEnd(test: { title: string }, result: { status?: string; outputDir?: string; attachments?: { path?: string }[] }): void {
    if (result.status === "passed" || result.status === "skipped") return;
    // The manifest the system writes into the runner's own output directory says which evidence
    // directory this test's frames and stories went to.
    const from = result.outputDir ?? WitnessReporter.outputDirOf(result.attachments ?? []);
    const dir = from ? WitnessReporter.evidenceDir(from) : undefined;
    if (!dir) return;
    const stories = WitnessReporter.stories(path.join(dir, "actions"));
    // A run of six actions where one broke printed all six, under a heading promising the failing
    // ones — so the story that mattered was one of six paths and nothing said which. The story
    // itself knows: it recorded whether it finished.
    const broke = stories.filter(story => story.ok === false).map(story => story.file);
    if (broke.length) for (const file of broke) this.failures.push(file);
    // Nothing broke inside an action, so the assertion was in the spec: the whole run IS the context.
    else if (stories.length) for (const story of stories) this.context.push(story.file);
    else this.context.push(path.join(dir, "frames"));
  }

  onEnd(): void {
    const lines = (files: string[]): string => [...new Set(files)].map(file => `  ${file}`).join("\n");
    if (this.failures.length) {
      process.stdout.write(
        `\nwhat broke, step by step — the network and console of the action that failed, tied to the step:\n` +
          `${lines(this.failures)}\n`,
      );
      return;
    }
    if (!this.context.length) return;
    // Every action ran; the test still failed. Say that, rather than pointing at these as breakages.
    process.stdout.write(
      `\nevery action finished — the failure was in the spec. What the run saw:\n${lines(this.context)}\n`,
    );
  }

  private static outputDirOf(attachments: { path?: string }[]): string | undefined {
    const anywhere = attachments.find(attachment => attachment.path)?.path;
    return anywhere ? path.dirname(anywhere) : undefined;
  }

  private static evidenceDir(outputDir: string): string | undefined {
    for (const at of [outputDir, path.dirname(outputDir)]) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(at, "evidence.json"), "utf8")) as { dir?: string };
        if (manifest.dir) return manifest.dir;
      } catch {
        // Not this directory, or no manifest: try the parent, then give up quietly.
      }
    }
    return undefined;
  }

  private static stories(at: string): { file: string; ok?: boolean }[] {
    try {
      return fs
        .readdirSync(at, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => ({ file: path.join(at, entry.name, "debug.md"), ok: WitnessReporter.finished(path.join(at, entry.name, "debug.json")) }))
        .filter(story => fs.existsSync(story.file));
    } catch {
      return [];
    }
  }

  /** Whether that action ran to the end, per the story it wrote beside itself. */
  private static finished(manifest: string): boolean | undefined {
    try {
      return (JSON.parse(fs.readFileSync(manifest, "utf8")) as { ok?: boolean }).ok;
    } catch {
      return undefined;
    }
  }
}
