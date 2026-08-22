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

  onTestEnd(test: { title: string }, result: { status?: string; outputDir?: string; attachments?: { path?: string }[] }): void {
    if (result.status === "passed" || result.status === "skipped") return;
    // The manifest the system writes into the runner's own output directory says which evidence
    // directory this test's frames and stories went to.
    const from = result.outputDir ?? WitnessReporter.outputDirOf(result.attachments ?? []);
    const dir = from ? WitnessReporter.evidenceDir(from) : undefined;
    if (!dir) return;
    for (const story of WitnessReporter.stories(path.join(dir, "actions"))) this.failures.push(story);
    if (!this.failures.length) this.failures.push(path.join(dir, "frames"));
  }

  onEnd(): void {
    if (!this.failures.length) return;
    process.stdout.write(
      `\nwhat happened, step by step — each failing run's network and console, tied to the step:\n` +
        `${[...new Set(this.failures)].map(file => `  ${file}`).join("\n")}\n`,
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

  private static stories(at: string): string[] {
    try {
      return fs
        .readdirSync(at, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(at, entry.name, "debug.md"))
        .filter(file => fs.existsSync(file));
    } catch {
      return [];
    }
  }
}
