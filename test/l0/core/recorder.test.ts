import { describe, expect, it } from 'vitest'
import { ARTIFACT_KINDS, isArtifactKind, validateRecording } from '../../../src/core/seams.js'
import type { StoryArtifact } from '../../../src/core/types.js'

/**
 * The recorder seam — "the layer that grows".
 *
 * A recorder is a *session*, not a per-step callback: a video is one
 * continuous artefact spanning a whole run, and `mark` is what ties a moment
 * in it back to a story step. A per-step `capture()` cannot express that,
 * which is how video ends up buried inside a driver instead of behind the
 * seam where every consumer can find it.
 */
describe('ArtifactKind', () => {
  it('names video and cast as first-class kinds, not driver internals', () => {
    expect(ARTIFACT_KINDS).toContain('video')
    expect(ARTIFACT_KINDS).toContain('cast')
  })

  it('covers everything a recorder in the design can emit', () => {
    for (const kind of ['frame', 'video', 'transcript', 'snapshot', 'cast', 'log']) {
      expect(ARTIFACT_KINDS).toContain(kind)
    }
  })

  it('rejects a kind nothing declares, so a typo cannot become a new kind', () => {
    expect(isArtifactKind('video')).toBe(true)
    expect(isArtifactKind('vidoe')).toBe(false)
  })
})

/**
 * A declared contract that nothing checks is a comment. `produces` is the
 * recorder's promise about what it will emit; these are the checks that make
 * the promise mean something, and they are pure so every consumer — the
 * runner, the conformance suite, a third-party recorder's own tests — can
 * apply exactly the same ones.
 */
describe('validateRecording — the contract every recorder is held to', () => {
  const artifact = (over: Partial<StoryArtifact> = {}): StoryArtifact => ({
    kind: 'video',
    path: 'artifacts/video/run.mp4',
    sha256: 'a'.repeat(64),
    bytes: 1024,
    readableBy: ['human'],
    ...over,
  })

  it('accepts a recorder that emitted what it said it would', () => {
    expect(validateRecording({ name: 'browser', produces: ['video'] }, [artifact()])).toEqual([])
  })

  it('rejects an artefact kind the recorder never declared', () => {
    const violations = validateRecording({ name: 'browser', produces: ['video'] }, [artifact({ kind: 'cast' })])
    expect(violations.join(' ')).toMatch(/cast/)
    expect(violations.join(' ')).toMatch(/produces/)
  })

  it('rejects a kind no recorder may emit, so a typo cannot invent one', () => {
    const violations = validateRecording({ name: 'x', produces: ['video'] }, [artifact({ kind: 'vidoe' })])
    expect(violations.join(' ')).toMatch(/vidoe/)
  })

  it('rejects an artefact with no declared reader', () => {
    // An artefact nobody is declared to read cannot be budgeted, dropped or
    // surfaced correctly: the store decides what to shed by reader.
    const violations = validateRecording({ name: 'x', produces: ['video'] }, [artifact({ readableBy: [] })])
    expect(violations.join(' ')).toMatch(/reader/i)
  })

  it('requires at least one agent-readable artefact when anything was produced', () => {
    // SV030: the agent is the primary user and cannot watch a video. A run
    // whose only evidence is an mp4 has produced nothing an agent can check.
    const violations = validateRecording({ name: 'browser', produces: ['video'] }, [artifact()], { requireAgentReadable: true })
    expect(violations.join(' ')).toMatch(/agent/i)
  })

  it('is satisfied by a transcript alongside the video', () => {
    const pair = [artifact(), artifact({ kind: 'transcript', path: 'artifacts/transcript/run.txt', readableBy: ['agent'] })]
    expect(validateRecording({ name: 'terminal', produces: ['video', 'transcript'] }, pair, { requireAgentReadable: true })).toEqual([])
  })

  it('does not demand a reader from a recorder that legitimately produced nothing', () => {
    // "Records nothing" is the runner's call to make — it knows whether
    // recording was asked for. The validator only judges what was emitted.
    expect(validateRecording({ name: 'terminal', produces: ['video'] }, [], { requireAgentReadable: true })).toEqual([])
  })
})
