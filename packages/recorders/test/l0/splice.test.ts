import { describe, expect, it } from 'vitest'
import { concatArgs, slideClipArgs } from '../../src/splice.js'

/**
 * A slide is a card spliced into the film, not text typed into the thing being
 * filmed. Narration written into the app — or into the shell — pollutes the
 * only frame that is supposed to be evidence: a viewer can no longer tell what
 * the product did from what the harness said about it.
 */
describe('slideClipArgs — a still card becomes a clip', () => {
  const args = slideClipArgs({ image: '/e/card.png', output: '/e/card.mp4', seconds: 3, width: 1280, height: 720 })

  it('holds the card for the time a reader needs', () => {
    expect(args.join(' ')).toMatch(/-t 3/)
  })

  it('produces the same codec as the clip it will be joined to', () => {
    expect(args).toContain('libx264')
    expect(args).toContain('yuv420p')
  })

  it('matches the clip geometry, or concat refuses to join them', () => {
    expect(args.join(' ')).toMatch(/1280[x:]720/)
  })

  it('builds the clip from a still image rather than a video input', () => {
    expect(args.join(' ')).toMatch(/-loop 1/)
    expect(args[args.indexOf('-i') + 1]).toBe('/e/card.png')
  })

  it('adds no audio stream, because the recordings have none to match', () => {
    expect(args).not.toContain('-c:a')
    expect(args).not.toContain('anullsrc')
  })
})

describe('concatArgs — the finished film', () => {
  const args = concatArgs({ listFile: '/e/parts.txt', output: '/e/final.mp4' })

  it('joins the parts without re-encoding, which is fast and lossless', () => {
    expect(args.join(' ')).toMatch(/-f concat/)
    expect(args.join(' ')).toMatch(/-c copy/)
  })

  it('allows absolute paths in the list, which ffmpeg refuses by default', () => {
    expect(args.join(' ')).toMatch(/-safe 0/)
  })

  it('keeps the index at the front so the file streams on GitHub', () => {
    expect(args.join(' ')).toMatch(/\+faststart/)
  })
})
