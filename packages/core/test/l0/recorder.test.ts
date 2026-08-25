import { describe, expect, it } from 'vitest'
import { ARTIFACT_KINDS, isArtifactKind } from '../../src/seams.js'

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
