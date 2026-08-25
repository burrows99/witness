import { describe, expect, it } from 'vitest'
import { ffmpegArgs, hasFfmpeg, slideDocument } from '../../src/video.js'

/**
 * Playwright writes `.webm`. A reviewer opens a PR on a phone, so the
 * deliverable is `.mp4` with H.264 and faststart — a video nobody can play is
 * not evidence.
 */
describe('ffmpegArgs', () => {
  const args = ffmpegArgs({ input: '/runs/1/a.webm', output: '/runs/1/a.mp4' })

  it('encodes H.264 with yuv420p, which is what players actually accept', () => {
    expect(args).toContain('libx264')
    expect(args).toContain('yuv420p')
  })

  it('moves the index to the front so the file streams before it finishes downloading', () => {
    expect(args.join(' ')).toMatch(/-movflags \+faststart/)
  })

  it('pads odd dimensions, which H.264 refuses', () => {
    expect(args.join(' ')).toMatch(/pad=ceil|scale=|trunc/)
  })

  it('overwrites without prompting, because a run must not block on stdin', () => {
    expect(args).toContain('-y')
  })

  it('names the input and output it was given', () => {
    expect(args).toContain('/runs/1/a.webm')
    expect(args).toContain('/runs/1/a.mp4')
  })

  it('holds the last frame when asked, so a video does not end mid-sentence', () => {
    expect(ffmpegArgs({ input: 'a.webm', output: 'a.mp4', holdLastFrameMs: 1200 }).join(' ')).toMatch(/tpad|freeze/)
  })
})

describe('slideDocument — the title card between clips', () => {
  it('renders the title and the detail', () => {
    const html = slideDocument({ title: 'The bug', detail: 'deleting a firing rule', watch: 'the dock' }, 1280, 720)
    expect(html).toMatch(/The bug/)
    expect(html).toMatch(/deleting a firing rule/)
    expect(html).toMatch(/Watch for/)
  })

  it('shows which branch it filmed, so a pair of recordings reads as a pair', () => {
    expect(slideDocument({ title: 'x', group: 'main' }, 800, 600)).toMatch(/MAIN/)
    expect(slideDocument({ title: 'x', group: 'fix/thing' }, 800, 600)).toMatch(/FIX\/THING/)
  })

  it('tints the baseline branch differently from a feature branch', () => {
    const baseline = slideDocument({ title: 'x', group: 'main' }, 800, 600)
    const feature = slideDocument({ title: 'x', group: 'fix/thing' }, 800, 600)
    expect(baseline).not.toBe(feature)
  })

  it('escapes markup, because a title comes from a plan file', () => {
    expect(slideDocument({ title: '<script>alert(1)</script>' }, 800, 600)).not.toContain('<script>alert(1)')
  })

  it('sizes itself to the frame it will be spliced into', () => {
    expect(slideDocument({ title: 'x' }, 1600, 900)).toMatch(/1600px/)
  })
})

describe('hasFfmpeg', () => {
  it('answers without throwing, so a missing encoder degrades rather than crashing', () => {
    expect(typeof hasFfmpeg()).toBe('boolean')
  })
})
