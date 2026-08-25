/**
 * Checking that attached evidence is really there.
 *
 * The playbook told agents to confirm a recording had rendered by reading
 * `video.readyState` in a browser. Two agents independently got `readyState:
 * 0` on attachments that were perfectly fine — under contention the video
 * element's own fetch never fired at all — and both, correctly, refused to
 * claim a pass they could not see. Both were wrong about the evidence.
 *
 * A browser is the wrong instrument. The question is whether the URL resolves
 * to real media bytes, and that needs no browser, no login session and no
 * rendering: follow the redirect, look at what comes back.
 */

/** GitHub's attachment URLs, in the order they appear, without duplicates. */
export function attachmentIds(body: string): string[] {
  const pattern = /https:\/\/github\.com\/user-attachments\/assets\/([0-9a-f-]{36})/g
  const seen = new Set<string>()
  for (const match of body.matchAll(pattern)) seen.add(match[1]!)
  return [...seen]
}

export interface AttachmentProbe {
  id: string
  status: number
  contentType: string
  bytes: number
}

export interface AttachmentVerdict {
  id: string
  ok: boolean
  detail: string
}

/** Smaller than any real recording; a placeholder or an error page. */
const MIN_BYTES = 1024

export function verdictFor(probe: AttachmentProbe): AttachmentVerdict {
  if (probe.status !== 200) {
    return { id: probe.id, ok: false, detail: `the attachment URL answered ${probe.status}` }
  }
  // A signed-out fetch returns a login page with status 200, so the status
  // alone would call an unreadable attachment good evidence.
  if (!/^(video|image)\//.test(probe.contentType)) {
    return { id: probe.id, ok: false, detail: `served ${probe.contentType}, not media — the link resolves to a page, not a file` }
  }
  if (probe.bytes < MIN_BYTES) {
    return { id: probe.id, ok: false, detail: `${probe.bytes} bytes is too small to be a recording` }
  }
  return { id: probe.id, ok: true, detail: `${probe.contentType}, ${probe.bytes} bytes` }
}
