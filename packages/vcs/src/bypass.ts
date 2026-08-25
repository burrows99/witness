import type { Bypass } from '@macquery-labs/core'

export const DEFAULT_BYPASS_LABEL = 'witness:bypass'

/**
 * A bypass must carry a reason (FR-6). A label alone says "let me through";
 * it does not say why, and the reason is the whole point — it is what makes
 * the escape hatch visible to a reviewer instead of silent.
 *
 * The reason is looked for in the change description as
 * `witness:bypass: <reason>`, so it lives with the change rather than in
 * CI configuration.
 */
const REASON_RE = /witness:bypass:\s*(.+)/i

export function reasonFromBody(body: string | undefined): string | null {
  if (!body) return null
  const m = REASON_RE.exec(body)
  const reason = m?.[1]?.trim()
  return reason ? reason : null
}

export function explicitBypass(reason: string | undefined, actor?: string): Bypass | null {
  const trimmed = reason?.trim()
  if (!trimmed) return null
  return { reason: trimmed, source: 'cli', ...(actor ? { actor } : {}) }
}

export function labelBypass(
  labels: readonly string[],
  label: string,
  body: string | undefined,
  actor: string | undefined,
): Bypass | null {
  if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) return null
  const reason = reasonFromBody(body)
  // Label present but no reason: refused, and the gate stays red. Saying
  // "bypassed for no stated reason" would defeat FR-6.
  if (!reason) return null
  return { reason, source: 'label', ...(actor ? { actor } : {}) }
}
