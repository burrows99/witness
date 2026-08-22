import * as fs from "node:fs";
import * as path from "node:path";

import { loadConfig } from "../config/index.ts";
import { videoProviders } from "../providers/video.ts";
import { Workspace } from "../environment/workspace.ts";

/**
 * After the suite: turn the run's recordings into MP4s.
 *
 * Wired as the test runner's global teardown and driven entirely by the config's `video` block, so
 * every spec produces a watchable artefact without anyone adding it to a script. Best-effort — a
 * transcode failure must not fail a run that passed.
 */
export function renderVideos(where: Workspace | string): string[] {
  const workspace = typeof where === "string" ? Workspace.find({ config: where }) : where;
  const config = loadConfig(workspace.configFile);
  const spec = config.video ?? {};
  const provider = videoProviders.get(spec.provider ?? "ffmpeg");
  if (!provider.available()) {
    process.stderr.write("[video] ffmpeg is not installed — skipping the MP4s\n");
    return [];
  }
  // Recordings and videos live where everything else this run produced lives.
  const written = provider.render(spec, workspace.dir);
  for (const file of written) process.stdout.write(`wrote ${file.replace(`${workspace.dir}/`, "")}\n`);
  reportFailures(path.join(workspace.dir, spec.from ?? "artifacts/test-results"));
  return written;
}

/** The default export a Playwright config points `globalTeardown` at. */
export function teardownFor(configFile?: string): () => void {
  return () => {
    try {
      renderVideos(configFile ?? Workspace.find());
    } catch (err) {
      process.stderr.write(`[video] generation failed: ${String(err)}\n`);
    }
  };
}

/**
 * The last word on a run that failed: where the story is.
 *
 * A runner prints the error, then a wall of attachment paths, then its summary. This says where the
 * story is; it cannot be the LAST thing said, because a global teardown runs before the reporter's
 * summary — that is what `@burrows99/witness/reporter` is for.
 *
 * A failed test is one whose output directory holds an `error-context.md`; the manifest beside it says
 * which evidence directory the test's own frames and stories went to.
 */
function reportFailures(from: string): void {
  try {
    const failed: string[] = [];
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(from, entry.name);
      if (!fs.existsSync(path.join(dir, "error-context.md"))) continue;
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "evidence.json"), "utf8")) as { dir?: string };
      if (!manifest.dir) continue;
      for (const story of stories(path.join(manifest.dir, "actions"))) failed.push(story);
    }
    if (failed.length) {
      process.stdout.write(
        `\nwhat happened, step by step — the network and console of each failing run, by step:\n${failed
          .map(file => `  ${file}`)
          .join("\n")}\n`,
      );
    }
  } catch {
    // A pointer is a courtesy; never fail a teardown over one.
  }
}

function stories(at: string): string[] {
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
