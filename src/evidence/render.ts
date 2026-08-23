import * as path from "node:path";

import { loadConfig } from "../config/index.ts";
import { videoProviders } from "../providers/video.ts";
import { Workspace } from "../environment/workspace.ts";

/**
 * After the suite: turn the run's recordings into MP4s.
 *
 * Driven entirely by the config's `video` block, and done in this process at the end of a run: the
 * reason to drive a UI at all is to see what happened, and a `.webm` named after a page id is not
 * that. Best-effort — a transcode failure must not fail a run that worked.
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
  // On stderr, not stdout: stdout carries the answer, and a progress line printed before the JSON
  // means the tool's own output cannot be piped into anything that parses it.
  for (const file of written) process.stderr.write(`wrote ${file.replace(`${workspace.dir}/`, "")}\n`);
  return written;
}
