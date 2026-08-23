import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Everything a run left on disk, listed in one file.
 *
 * This lived in the video provider, because rendering happens last and last is when a list of what
 * exists can be written. That is a reason to CALL it there, not a reason for it to live there: none
 * of it is about video, and the provider was a third indexing.
 */
function countFiles(dir: string, recursive = false): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
      if (entry.isDirectory()) return total + (recursive ? countFiles(path.join(dir, entry.name), true) : 0);
      return total + 1;
    }, 0);
  } catch {
    return 0;
  }
}

/**
 * One page listing what is THERE, not what this run happened to produce.
 *
 * Written from the tree, deliberately: the question anyone actually has is "where is the before cut of
 * the thing I changed", and the before cut was recorded by a different run. An index that only knew
 * about the latest one would answer that question wrongly every time it mattered.
 */
export function writeCatalogue(out: string): void {
  const bySpec = new Map<string, { test: string; cut: string; dir: string }[]>();
  for (const spec of listDirs(out)) {
    if (spec === "test-results" || spec === "report" || spec === "unattributed") continue;
    for (const test of listDirs(path.join(out, spec))) {
      for (const cut of listDirs(path.join(out, spec, test))) {
        const dir = path.join(out, spec, test, cut);
        if (!fs.existsSync(path.join(dir, "video.mp4")) && !fs.existsSync(path.join(dir, "frames"))) continue;
        bySpec.set(spec, [...(bySpec.get(spec) ?? []), { test, cut, dir }]);
      }
    }
  }

  const lines = [
    "# Evidence",
    "",
    "Every artefact currently on disk. One directory per run and cut, so the two halves",
    "of a before/after sit beside each other and a re-run overwrites rather than accumulates.",
    "",
  ];
  for (const spec of [...bySpec.keys()].sort()) {
    lines.push(`## ${spec}`, "");
    for (const entry of bySpec.get(spec)!.sort((a, b) => `${a.test}${a.cut}`.localeCompare(`${b.test}${b.cut}`))) {
      const relative = path.relative(out, entry.dir);
      const frames = countFiles(path.join(entry.dir, "frames"));
      const actions = countFiles(path.join(entry.dir, "actions"), true);
      const parts = [
        fs.existsSync(path.join(entry.dir, "video.mp4")) ? `[video](${path.join(relative, "video.mp4")})` : "no video",
        frames ? `${frames} frame${frames === 1 ? "" : "s"}` : "",
        actions ? `${actions} action frame${actions === 1 ? "" : "s"}` : "",
        fs.existsSync(path.join(entry.dir, "manual-verification.md"))
          ? `[how to check by hand](${path.join(relative, "manual-verification.md")})`
          : "",
      ].filter(Boolean);
      lines.push(`- **${entry.cut}** · ${entry.test} — ${parts.join(" · ")}`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(out, "index.md"), lines.join("\n"));
}

function listDirs(at: string): string[] {
  try {
    return fs.readdirSync(at, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}
