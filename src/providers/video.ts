import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Registry } from "./registry.ts";
import { writeCatalogue } from "../evidence/catalogue.ts";

/**
 * Turning a run's raw recordings into something a person will actually watch.
 *
 * A test runner leaves one webm per page in a directory named after the test — mangled to fit a
 * filesystem, and nobody opens it. This makes an MP4 per test automatically, and puts it with the rest
 * of that test's evidence rather than in a pile of videos: a spec that drove two pages is stitched side
 * by side, because that is the whole point of recording two things happening together.
 *
 * Where each one belongs comes from the manifest the system wrote next to the recording, so nothing
 * here has to guess a name from a directory. A recording with no manifest still gets a video, filed
 * under what can be read off the directory — but it is a fallback, not the path.
 */
export type VideoConfig = {
  provider?: string;
  /** Where the runner left its recordings. */
  from?: string;
  /** Where the MP4s go. */
  out?: string;
  encode?: { fps?: number; crf?: number; width?: number; preset?: string };
  /**
   * How several recordings from one test are laid out.
   *
   * `auto` puts two or three side by side and four or more in a grid: a reviewer sees the video about
   * 800px wide, so four in a row leaves 200px each and the comparison — which IS the claim — becomes
   * unreadable. `panelWidth` is the width each panel is scaled to.
   */
  layout?: { columns?: number | "auto"; panelWidth?: number; border?: string; fill?: string };
  /** Optional overrides, keyed by the start of the recording directory name. */
  clips?: Record<string, { name?: string; layout?: "single" | "side-by-side"; width?: number }>;
  /** Write an index of everything a run produced. Defaults to on. */
  index?: boolean;
};

export type VideoProvider = {
  available: () => boolean;
  /** Returns the files it wrote. */
  render: (config: VideoConfig, root: string) => string[];
};

const ffmpeg = (args: string[]): void => {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
};

export const videoProviders = new Registry<VideoProvider>("video").register("ffmpeg", {
  available: () => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  },

  render: (config, root) => {
    // Relative to the `.witness` directory, like every other path a config declares.
    const from = path.join(root, config.from ?? "artifacts/test-results");
    const out = path.join(root, config.out ?? "artifacts");
    if (!fs.existsSync(from)) return [];
    fs.mkdirSync(out, { recursive: true });

    const { fps = 24, crf = 24, preset = "veryfast", width = 1280 } = config.encode ?? {};
    const encode = ["-r", String(fps), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(crf),
                    "-preset", preset, "-movflags", "+faststart"];

    const written: string[] = [];
    for (const dir of fs.readdirSync(from)) {
      const at = path.join(from, dir);
      if (!fs.statSync(at).isDirectory()) continue;
      // `panel-<lane>-<attempt>.webm` when the run fixed an order — a lane per action driven in
      // parallel, an attempt per retry — otherwise whatever the browser named them. Sorting by
      // filename alone puts panels in page-id order, which is nobody's intended reading.
      const all = fs.readdirSync(at).filter(f => f.endsWith(".webm")).sort();
      const ordered = all.filter(f => f.startsWith("panel-"));
      const recordings = (ordered.length ? ordered : all).map(f => path.join(at, f));
      if (!recordings.length) continue;

      // The runner names the directory after the spec, a hash, and a fragment of the test title. The
      // spec name alone is what anyone looking for the video will search for — the title fragment is
      // only added when one spec produced more than one recording, to keep them apart.
      // The manifest says which spec, which test and which cut this recording is — written by the
      // system at the start of the test, so no name has to be reconstructed from a directory.
      const manifest = readManifest(at);
      const override = Object.entries(config.clips ?? {}).find(([key]) => dir.startsWith(key))?.[1];
      const groupDir = manifest?.dir ?? path.join(out, fallbackGroup(dir));
      const target = override?.name
        ? path.join(out, `${override.name}.mp4`)
        : path.join(groupDir, "video.mp4");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const layout = override?.layout ?? (recordings.length > 1 ? "side-by-side" : "single");
      const scale = override?.width ?? (layout === "side-by-side" ? 1920 : width);

      try {
        const stitched = recordings.length > 1 ? path.join(out, `.${path.basename(target)}.grid.mp4`) : target;
        if (recordings.length > 1) {
          grid(recordings, stitched, config.layout ?? {}, encode);
        } else {
          ffmpeg(["-i", recordings[0], "-vf", `scale=${scale}:-2,format=yuv420p`, "-map", "0:v", ...encode, target]);
        }

        // Slides are spliced into the timeline rather than laid over it: one full-frame card, held for
        // as long as the spec held it, then the stretch of app that card was introducing. A title
        // repeated in every panel reads as four things happening at once.
        if (recordings.length > 1 || fs.existsSync(path.join(at, "slides.json"))) {
          present(at, stitched, target, encode);
        }
        written.push(target);
      } catch (err) {
        // One unreadable recording must not cost the rest of the run its videos.
        process.stderr.write(`[video] ${dir}: ${String(err).slice(0, 200)}\n`);
      }
    }
    if (config.index !== false) writeCatalogue(out);

    // A run that records nothing must not look like a success: a spec opening its own context has to
    // pass `recordVideo` itself, and when it forgets, everything passes and no evidence exists.
    if (!written.length && fs.readdirSync(from).length) {
      process.stderr.write(`[video] ${from} holds no .webm — the run recorded nothing\n`);
    }
    return written;
  },
});

type Manifest = { source: string; test: string; cut: string; group: string; dir: string };
type SlideMark = { atMs: number; holdMs: number; image: string };

/**
 * Several recordings, laid out as panels of one frame.
 *
 * Built for N rather than two: a form that hard-codes the first two while reporting the real count
 * silently drops a panel, which is the exact failure this kind of evidence exists to catch.
 */
function grid(recordings: string[], target: string, layout: NonNullable<VideoConfig["layout"]>, encode: string[]): void {
  ffmpeg([
    ...recordings.flatMap(clip => ["-i", clip]),
    "-filter_complex", gridFilter(recordings.length, layout),
    "-map", "[v]", ...encode, target,
  ]);
}

/**
 * The filter graph that lays N recordings out as panels of one frame.
 *
 * Its own function because it is the part with a decision in it — how many columns, where each cell
 * starts — and the failure it prevents (a panel silently dropped, or a four-across strip 200px wide) is
 * invisible in the ffmpeg invocation that carries it.
 */
export function gridFilter(n: number, layout: NonNullable<VideoConfig["layout"]> = {}): string {
  const columns = layout.columns === undefined || layout.columns === "auto" ? (n >= 4 ? 2 : n) : layout.columns;
  const panelWidth = layout.panelWidth ?? 960;
  const border = layout.border ?? "0x312e81";
  const fill = layout.fill ?? "0x1e1b4b";

  // A 2px inset on every panel, so the seam between two reads as a divider rather than as one window
  // with a stripe in it.
  const cells = Array.from({ length: n }, (_, i) => i);
  const chain = cells.map(i => `[${i}:v]pad=iw+4:ih+4:2:2:color=${border}[p${i}];`).join("");
  const refs = cells.map(i => `[p${i}]`).join("");
  // xstack takes references and `+`, not arithmetic, so a cell's origin is written as a sum.
  const positions = cells
    .map(i => {
      const column = i % columns;
      const row = Math.floor(i / columns);
      const x = column ? Array(column).fill("w0").join("+") : "0";
      const y = row ? Array(row).fill("h0").join("+") : "0";
      return `${x}_${y}`;
    })
    .join("|");

  return `${chain}${refs}xstack=inputs=${n}:layout=${positions}:fill=${fill},scale=${panelWidth * columns}:-2,format=yuv420p[v]`;
}

/**
 * Turn a recording into a presentation: card, clip, card, clip.
 *
 * For every slide the spec marked, the window it occupied is cut OUT of the recording and one
 * full-frame card spliced in its place. The stretch before the first card — signing in, fixtures,
 * waiting for a stack — is dropped, so the video opens on the first thing it means to show.
 */
function present(dir: string, source: string, target: string, encode: string[]): void {
  const manifest = path.join(dir, "slides.json");
  if (!fs.existsSync(manifest)) {
    if (source !== target) fs.renameSync(source, target);
    return;
  }
  const marks = JSON.parse(fs.readFileSync(manifest, "utf8")) as SlideMark[];
  if (!marks.length) {
    if (source !== target) fs.renameSync(source, target);
    return;
  }

  const size = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", source],
    { encoding: "utf8" },
  ).trim();

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "witness-present-"));
  const parts: string[] = [];
  marks.forEach((mark, index) => {
    const card = path.join(work, `slide-${index}.mp4`);
    ffmpeg(["-loop", "1", "-t", String(mark.holdMs / 1000), "-i", path.join(dir, mark.image),
            "-vf", `scale=${size},format=yuv420p`, ...encode, card]);
    parts.push(card);

    const start = (mark.atMs / 1000 + mark.holdMs / 1000).toFixed(3);
    const clip = path.join(work, `clip-${index}.mp4`);
    const next = marks[index + 1];
    ffmpeg([
      ...(next ? ["-ss", start, "-to", (next.atMs / 1000).toFixed(3)] : ["-ss", start]),
      "-i", source, "-vf", "format=yuv420p", ...encode, clip,
    ]);
    parts.push(clip);
  });

  const list = path.join(work, "parts.txt");
  fs.writeFileSync(list, parts.map(part => `file '${part}'`).join("\n"));
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", target]);
  fs.rmSync(work, { recursive: true, force: true });
  if (source !== target) fs.rmSync(source, { force: true });
}

function readManifest(dir: string): Manifest | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "evidence.json"), "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}

/** Only for a recording with no manifest: keep the runner's own name, plainly. */
export function fallbackGroup(dir: string): string {
  return path.join("unattributed", dir.replace(/-[0-9a-f]{5,}-/, "-"));
}
