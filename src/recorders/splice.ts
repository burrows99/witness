/**
 * Splicing title cards into a recording.
 *
 * A slide is a card cut into the film, never text typed into the thing being
 * filmed. Narration written into the app — or into a shell — pollutes the only
 * frame that is meant to be evidence: a viewer can no longer separate what the
 * product did from what the harness said about it.
 *
 * The finished file runs slide → clip → slide → clip.
 */

export interface SlideClipOptions {
  image: string
  output: string
  seconds: number
  width: number
  height: number
  fps?: number
}

/** Turn a rendered card into a clip that can be concatenated with a recording. */
export function slideClipArgs(options: SlideClipOptions): string[] {
  const fps = options.fps ?? 30
  return [
    '-y',
    '-loop', '1',
    '-framerate', String(fps),
    '-i', options.image,
    '-t', String(options.seconds),
    // Geometry and pixel format must match the clip exactly, or the
    // stream-copy concat below refuses to join them.
    '-vf', `scale=${options.width}:${options.height},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    options.output,
  ]
}

export interface ConcatOptions {
  listFile: string
  output: string
}

export function concatArgs(options: ConcatOptions): string[] {
  return [
    '-y',
    '-f', 'concat',
    // ffmpeg rejects absolute paths in a concat list unless told otherwise.
    '-safe', '0',
    '-i', options.listFile,
    '-c', 'copy',
    '-movflags', '+faststart',
    options.output,
  ]
}

/** The concat list format: one `file '<path>'` per part. */
export function concatList(parts: readonly string[]): string {
  return `${parts.map((part) => `file '${part.replace(/'/g, "'\\''")}'`).join('\n')}\n`
}
