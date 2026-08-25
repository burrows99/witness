import { describe, expect, it } from 'vitest'
import { attachmentIds, verdictFor, type AttachmentProbe } from '../../src/attachment.js'

/**
 * L1 — checking that attached evidence is really there.
 *
 * The skill told agents to verify a recording rendered by reading
 * `video.readyState` in a browser. Two agents independently got `readyState:
 * 0` on attachments that were completely fine — the element's own fetch never
 * fired, because five other agents were driving the same browser. Both did
 * the right thing and refused to claim a pass, and both were wrong about the
 * evidence.
 *
 * A browser is the wrong instrument for this. The question is whether the URL
 * resolves to real video bytes, and that is answerable without one.
 */

describe('attachmentIds — what to check', () => {
  it('finds every attachment in a PR body', () => {
    const body = [
      '## Before', 'https://github.com/user-attachments/assets/07df3896-a5e6-4805-9561-3c48e9771792',
      '## After', 'https://github.com/user-attachments/assets/43e85eee-ed97-4362-b9e5-289da43ca28f',
    ].join('\n')
    expect(attachmentIds(body)).toEqual([
      '07df3896-a5e6-4805-9561-3c48e9771792',
      '43e85eee-ed97-4362-b9e5-289da43ca28f',
    ])
  })

  it('reports the same attachment once, however often it is linked', () => {
    const id = '07df3896-a5e6-4805-9561-3c48e9771792'
    expect(attachmentIds(`${id} again https://github.com/user-attachments/assets/${id}\nhttps://github.com/user-attachments/assets/${id}`)).toEqual([id])
  })

  it('finds nothing in a body that still carries placeholders', () => {
    // The failure this catches: publishing with BEFORE_VIDEO never replaced.
    expect(attachmentIds('## Before\nBEFORE_VIDEO\n## After\nAFTER_VIDEO')).toEqual([])
  })
})

describe('verdictFor — is this evidence, or a dead link?', () => {
  const ok: AttachmentProbe = { id: 'a', bytes: 148647, contentType: 'video/mp4', status: 200 }

  it('passes a real video', () => {
    expect(verdictFor(ok)).toMatchObject({ ok: true })
  })

  it('fails a URL that no longer resolves', () => {
    expect(verdictFor({ ...ok, status: 404 })).toMatchObject({ ok: false })
    expect(verdictFor({ ...ok, status: 404 }).detail).toMatch(/404/)
  })

  it('fails an attachment GitHub served as a login page rather than a file', () => {
    // A signed-out fetch returns HTML with status 200. Trusting the status
    // alone would call an unreadable attachment good evidence.
    const verdict = verdictFor({ ...ok, contentType: 'text/html' })
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toMatch(/text\/html/)
  })

  it('fails a file too small to be a recording', () => {
    const verdict = verdictFor({ ...ok, bytes: 12 })
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toMatch(/12 bytes/)
  })

  it('accepts any media type, not only mp4', () => {
    for (const contentType of ['video/webm', 'image/png', 'image/gif']) {
      expect(verdictFor({ ...ok, contentType }).ok, contentType).toBe(true)
    }
  })
})
