import { changedLinesOf, type NormalisedDiff } from './diff.js'
import type { Language } from './classify.js'
import type { ResolvedConfig } from './types.js'

/**
 * Diff-driven instrumentation — FR-9, TDD §7.5.
 *
 * The diff decides where probes go. No human and no agent picks lines, which
 * is the whole point: the collection burden is what agents skip, and a probe
 * plan that an agent authors is a probe plan an agent can under-author.
 *
 * This is pure: it emits targets as data. `core` never talks to a debugger.
 */

export interface ProbeTarget {
  id: string
  file: string
  line: number
  language: Language
  /** Variables to capture at the line. Read-only expressions, never calls. */
  expressions: string[]
}

export interface PlanProbesOptions {
  /** Called when the budget truncated the probe set, so it is never silent. */
  onTruncate?: (dropped: number) => void
}

const KEYWORDS: Record<Language, Set<string>> = {
  ts: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'typeof', 'instanceof', 'await', 'async', 'export', 'import', 'from', 'class', 'extends', 'try', 'catch', 'finally', 'throw', 'delete', 'void', 'in', 'of', 'yield', 'true', 'false', 'null', 'undefined', 'string', 'number', 'boolean', 'any', 'unknown', 'never', 'default', 'static', 'public', 'private', 'protected', 'readonly', 'type', 'interface', 'enum', 'as', 'satisfies']),
  py: new Set(['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'class', 'try', 'except', 'finally', 'raise', 'with', 'as', 'import', 'from', 'lambda', 'pass', 'break', 'continue', 'global', 'nonlocal', 'assert', 'yield', 'await', 'async', 'self']),
  go: new Set(['func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'package', 'import', 'nil', 'true', 'false', 'make', 'new', 'len', 'cap', 'append', 'string', 'int', 'int64', 'float64', 'bool', 'error']),
  java: new Set(['public', 'private', 'protected', 'static', 'final', 'class', 'interface', 'extends', 'implements', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'throws', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'String', 'var', 'null', 'true', 'false', 'import', 'package']),
}

/** At most this many expressions per probe; a wide line must not blow the budget. */
const MAX_EXPRESSIONS = 8

const STRINGS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g

/**
 * A plain assignment or a Go short declaration, but never `==`, `>=`, `=>`
 * or a compound assignment: `total += bonus` reads `total` before writing it,
 * so it is bound and worth capturing.
 */
const ASSIGNMENT = /^([^=!<>+\-*/%&|^]*?)(?::=|=)(?!=)/

/**
 * The variables worth capturing at a line, read straight from the line text.
 *
 * Deliberately syntactic rather than scope-aware: a per-language AST is the
 * cost this design is trying to avoid at this stage (Q1/D7), and a logpoint
 * that names a variable which is not in scope prints an adapter error at
 * worst — it never breaks the run, and the coverage signal does not depend
 * on it.
 */
export function identifiersIn(text: string, language: Language): string[] {
  // String contents are not identifiers, and a probe must never evaluate a
  // call: `f(x)` captures `x`, never `f`.
  const withoutStrings = text.replace(STRINGS, '""')

  // A logpoint fires *before* its line executes, so whatever the line assigns
  // is not bound yet. Interpolating it makes the adapter print its own error
  // instead of the log message, and the probe then looks like it never fired
  // — a false block from a line that ran perfectly well.
  const assigned = assignmentTargets(withoutStrings, language)
  const found: string[] = []
  const keywords = KEYWORDS[language]

  for (const match of withoutStrings.matchAll(IDENTIFIER)) {
    const name = match[0]
    const before = withoutStrings.slice(0, match.index)
    const after = withoutStrings.slice(match.index + name.length)
    if (keywords.has(name)) continue
    if (assigned.has(name)) continue
    if (/\.\s*$/.test(before)) continue      // property name, not a variable
    if (/^\s*\(/.test(after)) continue       // call target: evaluating it could have effects
    if (found.includes(name)) continue
    found.push(name)
    if (found.length >= MAX_EXPRESSIONS) break
  }
  return found
}

/**
 * The names a line binds. Arrow parameters count as bound *by the arrow*, not
 * by the enclosing assignment, so `const f = (a) => a * rate` binds only `f`.
 */
function assignmentTargets(text: string, language: Language): Set<string> {
  const targets = new Set<string>()
  const match = ASSIGNMENT.exec(text)
  if (!match) return targets
  const left = match[1] ?? ''
  // A left-hand side that indexes or dereferences is not a simple binding:
  // `obj.total = x` reads `obj`, which is bound.
  if (left.includes('.') || left.includes('[')) return targets
  const keywords = KEYWORDS[language]
  for (const found of left.matchAll(IDENTIFIER)) {
    const name = found[0]
    if (!keywords.has(name)) targets.add(name)
  }
  return targets
}

/**
 * One probe per gateable changed line — including defensive lines, because
 * the gate has to know whether they fired before it can apply a policy to
 * them.
 */
export function planProbes(diff: NormalisedDiff, policy: ResolvedConfig, options: PlanProbesOptions = {}): ProbeTarget[] {
  const gateable = diff.files
    .filter((f) => f.language !== null && !f.unsupportedLanguage)
    .flatMap((f) => f.lines.map((l) => ({ ...l, file: f.path, language: f.language! })))

  const budget = policy.budgets.probeLines
  const kept = gateable.slice(0, budget)
  if (kept.length < gateable.length) options.onTruncate?.(gateable.length - kept.length)

  return kept.map((line, index) => ({
    // Stable across runs of the same diff: `p001`, `p002`, … in diff order.
    id: `p${String(index + 1).padStart(3, '0')}`,
    file: line.file,
    line: line.line,
    language: line.language,
    expressions: identifiersIn(line.text, line.language),
  }))
}

/** Probes grouped per file, which is how DAP wants them: one call per source. */
export function groupByFile(targets: readonly ProbeTarget[]): Map<string, ProbeTarget[]> {
  const byFile = new Map<string, ProbeTarget[]>()
  for (const target of targets) {
    const existing = byFile.get(target.file)
    if (existing) existing.push(target)
    else byFile.set(target.file, [target])
  }
  return byFile
}

export { changedLinesOf }
