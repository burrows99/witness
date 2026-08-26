import { orderEvents, type CoverageLine, type Finding, type GateResult, type Story, type StoryEvent } from '../core/index.js'

/**
 * The story viewer — FR-16.
 *
 * One self-contained HTML file, because the only way a human ever sees this
 * is by downloading a CI artifact and opening it: no server, no network, no
 * build step (contracts §8).
 *
 * Everything a story carries is treated as data. A story is an artefact an
 * untrusted pull request can influence, so nothing from it is ever emitted
 * into markup or a script context unescaped (TDD §10.1).
 */

export interface ViewerInput {
  story: Story
  gate: GateResult | null
}

const TIERS = ['browser', 'server', 'data', 'harness'] as const

export function renderViewer({ story, gate }: ViewerInput): string {
  const events = orderEvents(story.events)
  const verdict = gate?.verdict ?? 'unknown'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>witness run ${esc(story.run_id)}</title>
<style>${STYLES}</style>
</head>
<body>
<header class="verdict verdict-${esc(verdict)}">
  <div class="verdict-line">
    <span class="badge">${esc(verdictLabel(verdict))}</span>
    <span class="intent">${esc(story.plan_id)}</span>
  </div>
  <dl class="facts">
    ${fact('coverage', `${story.coverage.summary.fired}/${gateableCount(story.coverage.lines)} changed lines exercised`)}
    ${fact('assertions', `${story.assertions.filter((a) => a.status === 'pass').length}/${story.assertions.length} passed`)}
    ${fact('diff', `${esc(story.diff.hash.slice(0, 20))}… (${esc(story.diff.algo)})`)}
    ${fact('run', esc(story.run_id))}
    ${fact('when', `${esc(story.started_at)} → ${esc(story.sealed_at ?? '—')}`)}
    ${fact('where', `${esc(story.vcs.provider)}${story.vcs.actor ? ` · ${esc(story.vcs.actor)}` : ''} · ${esc(story.env.runner)} · cli ${esc(story.env.cli)}`)}
  </dl>
</header>

${gate ? section('Why', renderFindings(gate.findings)) : ''}
${section('Coverage', renderCoverage(story.coverage.lines))}
${section('Timeline', renderSwimlanes(events))}
${section('Assertions', renderAssertions(story))}
${section('Artefacts', renderArtifacts(story))}
${story.diagnostics.length ? section('Harness diagnostics', renderDiagnostics(story)) : ''}

<footer>
  <p>Sealed ${story.seal ? `<code>${esc(story.seal.value.slice(0, 23))}…</code>` : 'unsealed'} · rendered offline by witness. Nothing here loads from the network.</p>
</footer>
</body>
</html>
`
}

function verdictLabel(verdict: string): string {
  return verdict === 'bypass' ? 'BYPASS (recorded)' : verdict.toUpperCase()
}

function gateableCount(lines: readonly CoverageLine[]): number {
  return lines.filter((l) => l.class === 'executable' || l.class === 'defensive' || l.class === 'unbound').length
}

function section(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`
}

function fact(label: string, value: string): string {
  return `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`
}

/**
 * The gate explainer. A finding without its remedy hands the reader a
 * research task, so the remedy is given the same weight as the message.
 */
function renderFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return `<p class="empty">No findings. Every changed line was exercised and every assertion passed.</p>`
  return `<ul class="findings">${findings.map((f) => `
    <li class="finding finding-${esc(f.severity)}">
      <div class="finding-head"><code>${esc(f.code)}</code> <span class="locus">${esc(locus(f))}</span></div>
      <div class="finding-message">${esc(f.message)}</div>
      <div class="finding-remedy">→ ${esc(f.remedy)}</div>
    </li>`).join('')}</ul>`
}

function locus(finding: Finding): string {
  const l = finding.locus
  if (!l) return ''
  if (l.file && l.line !== undefined) return `${l.file}:${l.line}`
  if (l.file) return l.file
  if (l.assertion_id) return `assertion ${l.assertion_id}`
  if (l.step_seq !== undefined) return `step ${l.step_seq}`
  return ''
}

/**
 * The coverage map, where the gaps are the finding. Grouped by file, because
 * that is how a reviewer reads a diff.
 */
function renderCoverage(lines: readonly CoverageLine[]): string {
  if (lines.length === 0) return `<p class="empty">Nothing gateable changed.</p>`
  const byFile = new Map<string, CoverageLine[]>()
  for (const line of lines) {
    const existing = byFile.get(line.file)
    if (existing) existing.push(line)
    else byFile.set(line.file, [line])
  }

  return [...byFile.entries()].map(([file, fileLines]) => `
    <div class="file">
      <div class="file-name">${esc(file)}</div>
      <div class="lines">${fileLines
        .slice()
        .sort((a, b) => a.line - b.line)
        .map((line) => `<span class="line line-${esc(state(line))}" data-line="${line.line}" data-state="${esc(state(line))}" title="${esc(describe(line))}">${line.line}</span>`)
        .join('')}</div>
    </div>`).join('')
}

function state(line: CoverageLine): string {
  if (line.class === 'waived') return 'waived'
  if (line.class === 'excluded') return 'excluded'
  if (line.verified === false || line.class === 'unbound') return 'unbound'
  return (line.hits ?? 0) > 0 ? 'fired' : 'unfired'
}

function describe(line: CoverageLine): string {
  switch (state(line)) {
    case 'fired': return `line ${line.line}: exercised ${line.hits ?? 0}×`
    case 'unfired': return `line ${line.line}: never executed`
    case 'unbound': return `line ${line.line}: probe accepted but never verified — the line was never watched`
    case 'waived': return `line ${line.line}: waived${line.reason ? ` — ${line.reason}` : ''}${line.expires ? ` (until ${line.expires})` : ''}`
    default: return `line ${line.line}: ${line.class}`
  }
}

/**
 * Swimlanes, one per tier, with the correlation thread drawn across them.
 * Order comes from `orderEvents`, never from wall clock: containers skew
 * clocks by more than a whole request.
 */
function renderSwimlanes(events: readonly StoryEvent[]): string {
  if (events.length === 0) return `<p class="empty">No events recorded.</p>`
  return `<div class="lanes">${TIERS.map((tier) => {
    const tierEvents = events.filter((e) => e.tier === tier)
    if (tierEvents.length === 0) return ''
    return `<div class="lane" data-tier="${esc(tier)}">
      <div class="lane-name">${esc(tier)}</div>
      <ol class="lane-events">${tierEvents.map(renderEvent).join('')}</ol>
    </div>`
  }).join('')}</div>`
}

function renderEvent(event: StoryEvent): string {
  const step = event.step_seq !== undefined ? `<span class="step">step ${event.step_seq}</span>` : ''
  const body = (() => {
    switch (event.type) {
      case 'step':
        return `<strong>${esc(event.driver)} ${esc(event.action)}</strong> ${esc(compact(event.args))}${event.status === 'error' ? ` <span class="bad">failed: ${esc(event.error ?? '')}</span>` : ''}`
      case 'logpoint':
        return `<strong>${esc(event.file)}:${event.line}</strong> <span class="vars">${esc(compact(event.vars))}</span>`
      case 'span':
        return `<strong>${esc(event.name)}</strong> <span class="muted">${event.duration_ms.toFixed(1)}ms</span> ${esc(compact(event.attrs))}`
      case 'assertion':
        return `assertion <code>${esc(event.assertion_id)}</code> <span class="${event.status === 'pass' ? 'good' : 'bad'}">${esc(event.status)}</span>`
      case 'diagnostic':
        return `<code>${esc(event.code)}</code> ${esc(event.message)}`
      case 'artifact':
        return `artefact #${event.artifact_index}`
    }
  })()
  return `<li class="event event-${esc(event.type)}"><span class="seq">${event.seq}</span>${step}<span class="event-body">${body}</span></li>`
}

function renderAssertions(story: Story): string {
  if (story.assertions.length === 0) {
    return `<p class="empty">This plan asserts nothing: the run proves the code was exercised, not that it behaved.</p>`
  }
  return `<table><thead><tr><th>id</th><th>status</th><th>difference</th></tr></thead><tbody>${story.assertions.map((a) => `
    <tr class="assertion-${esc(a.status)}"><td><code>${esc(a.id)}</code></td><td>${esc(a.status)}</td><td>${esc(a.diff ?? '')}</td></tr>`).join('')}</tbody></table>`
}

function renderArtifacts(story: Story): string {
  if (story.artifacts.length === 0) return `<p class="empty">No artefacts captured.</p>`
  return `<table><thead><tr><th>kind</th><th>path</th><th>readable by</th><th>bytes</th><th>step</th></tr></thead><tbody>${story.artifacts.map((a) => `
    <tr><td>${esc(a.kind)}</td><td><a href="${esc(a.path)}">${esc(a.path)}</a></td><td>${esc(a.readableBy.join(', '))}</td><td>${a.bytes}</td><td>${a.step_seq ?? ''}</td></tr>`).join('')}</tbody></table>`
}

function renderDiagnostics(story: Story): string {
  return `<ul class="findings">${story.diagnostics.map((d) => `
    <li class="finding finding-${esc(d.severity)}"><div class="finding-head"><code>${esc(d.code)}</code> <span class="locus">${esc(d.file ?? '')}${d.line ? `:${d.line}` : ''}</span></div><div class="finding-message">${esc(d.message)}</div></li>`).join('')}</ul>`
}

function compact(value: unknown): string {
  const text = JSON.stringify(value) ?? ''
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

/** Every value from a story goes through here. No exceptions. */
function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const STYLES = `
:root {
  --bg: #ffffff; --fg: #14161a; --muted: #6b7280; --line: #e5e7eb; --panel: #f9fafb;
  --ok: #15803d; --bad: #b91c1c; --warn: #a16207; --amber: #b45309;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1115; --fg: #e6e8eb; --muted: #9aa1ab; --line: #262a31; --panel: #161a20;
          --ok: #4ade80; --bad: #f87171; --warn: #fbbf24; --amber: #fbbf24; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 0 4rem; background: var(--bg); color: var(--fg);
       font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
header { padding: 1.5rem 2rem; border-bottom: 1px solid var(--line); }
.verdict-line { display: flex; align-items: center; gap: .75rem; }
.badge { font-weight: 700; letter-spacing: .04em; padding: .25rem .6rem; border-radius: 4px; color: #fff; background: var(--muted); }
.verdict-allow .badge { background: var(--ok); }
.verdict-block .badge { background: var(--bad); }
.verdict-bypass .badge { background: var(--amber); }
.intent { font-size: 1.1rem; font-weight: 600; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: .5rem 1.5rem; margin: 1rem 0 0; }
.facts dt { color: var(--muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
.facts dd { margin: 0; font-variant-numeric: tabular-nums; }
section { padding: 1.5rem 2rem; border-bottom: 1px solid var(--line); }
h2 { margin: 0 0 1rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.empty { color: var(--muted); margin: 0; }
.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: .75rem; }
.finding { border-left: 3px solid var(--muted); padding: .5rem .75rem; background: var(--panel); border-radius: 0 4px 4px 0; }
.finding-error { border-left-color: var(--bad); }
.finding-warn { border-left-color: var(--warn); }
.finding-head { display: flex; gap: .75rem; align-items: baseline; }
.finding-head code { font-weight: 700; }
.locus { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
.finding-remedy { color: var(--muted); margin-top: .25rem; }
.file { margin-bottom: .75rem; }
.file-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; color: var(--muted); margin-bottom: .25rem; }
.lines { display: flex; flex-wrap: wrap; gap: 3px; }
.line { font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: .3rem .35rem; border-radius: 3px;
        background: var(--panel); border: 1px solid var(--line); color: var(--muted); }
.line-fired { background: color-mix(in srgb, var(--ok) 20%, transparent); color: var(--ok); border-color: transparent; }
.line-unfired { background: color-mix(in srgb, var(--bad) 20%, transparent); color: var(--bad); border-color: transparent; }
.line-unbound { background: color-mix(in srgb, var(--warn) 25%, transparent); color: var(--warn); border-color: transparent; }
.line-waived { background: color-mix(in srgb, var(--amber) 18%, transparent); color: var(--amber); border-color: transparent; }
.lanes { display: grid; gap: .75rem; }
.lane { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.lane-name { background: var(--panel); padding: .35rem .75rem; font-size: .75rem; text-transform: uppercase;
             letter-spacing: .06em; color: var(--muted); }
.lane-events { list-style: none; margin: 0; padding: 0; }
.event { display: flex; gap: .75rem; align-items: baseline; padding: .35rem .75rem; border-top: 1px solid var(--line); }
.event .seq { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 2.5ch; text-align: right; }
.event .step { color: var(--muted); font-size: .75rem; min-width: 6ch; }
.event-body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; word-break: break-word; }
.vars, .muted { color: var(--muted); }
.good { color: var(--ok); } .bad { color: var(--bad); }
table { width: 100%; border-collapse: collapse; font-size: .9em; }
th { text-align: left; color: var(--muted); font-weight: 500; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
th, td { padding: .35rem .5rem; border-bottom: 1px solid var(--line); }
td a { color: inherit; }
.assertion-fail td { color: var(--bad); }
footer { padding: 1.5rem 2rem; color: var(--muted); font-size: .85em; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
`
