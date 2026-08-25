import type { GateResult } from '@swe-verify/core'

/** Shared rendering so every provider publishes the same facts. */

export const VERDICT_LABEL: Record<GateResult['verdict'], string> = {
  allow: 'ALLOW',
  block: 'BLOCK',
  bypass: 'BYPASS (recorded)',
}

export function headline(result: GateResult): string {
  const errors = result.findings.filter((f) => f.severity === 'error').length
  const warns = result.findings.length - errors
  const counts = [errors ? `${errors} error` : '', warns ? `${warns} warning` : ''].filter(Boolean).join(', ')
  return `swe-verify: ${VERDICT_LABEL[result.verdict]}${counts ? ` — ${counts}` : ''}`
}

export function locusOf(finding: GateResult['findings'][number]): string {
  const l = finding.locus
  if (!l) return ''
  if (l.file && l.line !== undefined) return `${l.file}:${l.line}`
  if (l.file) return l.file
  if (l.assertion_id) return `assertion ${l.assertion_id}`
  if (l.step_seq !== undefined) return `step ${l.step_seq}`
  return ''
}

export function textReport(result: GateResult): string[] {
  const lines = [headline(result)]
  for (const f of result.findings) {
    const where = locusOf(f)
    lines.push(`  ${f.code}  ${where ? `${where}  ` : ''}${f.message}`)
    lines.push(`         → ${f.remedy}`)
  }
  const m = result.metrics
  lines.push(`  coverage   ${m.fired}/${m.executable + m.defensive} changed lines exercised${m.waived ? `, ${m.waived} waived` : ''}${m.unverified ? `, ${m.unverified} unverified` : ''}`)
  lines.push(`  assertions ${m.assertionsPassed}/${m.assertionsTotal} passed`)
  return lines
}

export function markdownReport(result: GateResult): string {
  const m = result.metrics
  const rows = result.findings.map((f) => `| \`${f.code}\` | ${f.severity} | ${locusOf(f) || '—'} | ${f.message} | ${f.remedy} |`)
  return [
    `## ${headline(result)}`,
    '',
    `- coverage: **${m.fired}/${m.executable + m.defensive}** changed lines exercised${m.waived ? ` (${m.waived} waived)` : ''}`,
    `- assertions: **${m.assertionsPassed}/${m.assertionsTotal}** passed`,
    '',
    ...(rows.length
      ? ['| Code | Severity | Where | What happened | What to do |', '|---|---|---|---|---|', ...rows]
      : ['No findings.']),
  ].join('\n')
}
