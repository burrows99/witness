import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Turning a recording into something a reviewer will actually watch.
 *
 * Playwright writes `.webm`. A reviewer opens a pull request on a phone, in a
 * browser that may not decode VP8, so the deliverable is `.mp4` — H.264,
 * yuv420p, index at the front. A video nobody can play is not evidence.
 */

const run = promisify(execFile)

export interface TranscodeOptions {
  input: string
  output: string
  /**
   * Hold the final frame. A recording that cuts the instant the last action
   * completes ends before a viewer has read the last caption.
   */
  holdLastFrameMs?: number
  fps?: number
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

export function ffmpegArgs(options: TranscodeOptions): string[] {
  const filters = [
    // H.264 refuses odd dimensions, and a browser viewport is not always even.
    'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    ...(options.holdLastFrameMs ? [`tpad=stop_mode=clone:stop_duration=${(options.holdLastFrameMs / 1000).toFixed(2)}`] : []),
  ]

  return [
    '-y',
    '-i', options.input,
    '-vf', filters.join(','),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    ...(options.fps ? ['-r', String(options.fps)] : []),
    '-movflags', '+faststart',
    '-an',
    options.output,
  ]
}

export async function transcodeToMp4(options: TranscodeOptions): Promise<void> {
  await run('ffmpeg', ffmpegArgs(options), { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 })
}

export interface Slide {
  title: string
  detail?: string
  /** What a viewer should be looking at while the next clip plays. */
  watch?: string
  /**
   * A short label for the chip on the card — in practice the branch the
   * recording was taken from, so a pair of files reads as a pair.
   */
  group?: string
}

/**
 * The title card between clips. A finished recording runs
 * slide → clip → slide → clip, so a viewer is told what they are about to see
 * before they see it.
 */
export function slideDocument(card: Slide, width: number, height: number): string {
  const scale = width / 1280
  const px = (n: number) => `${Math.round(n * scale)}px`
  const esc = (raw: string) =>
    String(raw).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

  const group = card.group?.toUpperCase()
  // The default branch is where a bug is reproduced; anywhere else is where it
  // is fixed. Colouring on that alone is a guess, so it is only a hint.
  const isBaseline = group === 'MAIN' || group === 'MASTER'
  const chip = isBaseline ? 'background:#78350f;color:#fcd34d' : 'background:#065f46;color:#6ee7b7'

  return `<!doctype html><meta charset="utf-8"><body style="margin:0;width:${width}px;height:${height}px;
  background:radial-gradient(120% 120% at 0% 0%,#312e81 0%,#1e1b4b 55%,#0b1020 100%);
  color:#fff;font-family:-apple-system,system-ui,'Segoe UI',sans-serif;
  display:flex;flex-direction:column;justify-content:center;padding:0 ${px(64)};gap:${px(18)}">
  ${group ? `<div style="align-self:flex-start;padding:${px(5)} ${px(14)};border-radius:999px;
    font-size:${px(13)};letter-spacing:.16em;font-weight:700;${chip}">${esc(group)}</div>` : ''}
  <div style="font-size:${px(42)};font-weight:700;line-height:1.15;letter-spacing:-.02em">${esc(card.title)}</div>
  ${card.detail ? `<div style="font-size:${px(20)};opacity:.82;line-height:1.4">${esc(card.detail)}</div>` : ''}
  ${card.watch ? `<div style="font-size:${px(17)};opacity:.72;line-height:1.5;border-left:${px(3)} solid #a5b4fc;
    padding-left:${px(14)}">Watch for: ${esc(card.watch)}</div>` : ''}
</body>`
}
