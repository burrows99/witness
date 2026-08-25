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

describe('a caption that does not fit the frame', () => {
  /**
   * A real recording put a Go subtest name on a card —
   * `TestRuleRoutine/should_exit/and_send_resolved_notifications_...` — and it
   * ran off both edges of the 1280px frame. Browsers do not break on `/` or
   * `_`, so the line never wrapped and the narration, which is the whole
   * point of the card, was unreadable.
   */
  it('breaks a long unbroken token instead of running off the frame', () => {
    const title = 'TestRuleRoutine/should_exit/and_send_resolved_notifications_if_errRuleDeleted_is_the_reason_for_stopping'
    const html = slideDocument({ title }, 1280, 720)
    expect(html).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('shrinks the type as the caption grows, so a long one still fits', () => {
    const short = slideDocument({ title: 'The bug' }, 1280, 720)
    const long = slideDocument({ title: 'x'.repeat(240) }, 1280, 720)
    const sizeOf = (html: string) => Number(/font-size:(\d+)px;font-weight:700;line-height/.exec(html)?.[1] ?? 0)
    expect(sizeOf(short)).toBeGreaterThan(sizeOf(long))
    expect(sizeOf(long)).toBeGreaterThanOrEqual(16)
  })

  it('keeps the full caption rather than truncating what it cannot fit', () => {
    // A card that silently drops the end of a sentence is worse than a small
    // one: the reader cannot tell that anything is missing.
    const title = 'the resolved notification is sent on a cancelled context and never reaches the receiver'
    expect(slideDocument({ title }, 1280, 720)).toContain(title)
  })
})

describe('the card fits the frame it is rendered into', () => {
  it('sizes the box including its padding, not outside it', () => {
    // Content-box sizing put a 1280px column inside 64px of padding: the text
    // began inside the frame and ran off its right edge, which is how a
    // caption ends up half-visible in a recording.
    expect(slideDocument({ title: 'x' }, 1280, 720)).toMatch(/box-sizing:\s*border-box/)
  })
})
