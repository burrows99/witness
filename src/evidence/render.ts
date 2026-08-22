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
