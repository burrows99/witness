import { canonicalJson, sha256 } from './canonical.js'
import { classifyLine, gateability, type Language, type StaticLineClass } from './classify.js'

/**
 * Diff normalisation — `normalised-v1`.
 *
 * The algorithm is versioned inside the story (TDD §10.5). Changing
 * normalisation without bumping the version stales every open PR's story on
 * the day it ships, so the version is part of the contract, not an
 * implementation detail.
 *
 * Properties the tests pin down:
 *  - independent of base/head sha  → a rebase does not stale a story
 *  - independent of indentation    → a reformat does not stale a story
 *  - excluded lines dropped        → a comment-only PR normalises to empty,
 *                                    which is what lets US-1 AC4 pass
 *  - line numbers included         → moved code is a different change
 */
export const NORMALISATION_ALGO = 'normalised-v1' as const

export interface ChangedLine {
  line: number
  text: string
  class: StaticLineClass
}

export interface ChangedFile {
  path: string
  language: Language | null
  /**
   * Set when the file is code in a language with no trustworthy DAP adapter.
   * Its lines are kept — they are a real change — but the gate reports the
   * gap rather than pretending to have covered it (Q7).
   */
  unsupportedLanguage?: string
  lines: ChangedLine[]
}

export interface NormalisedDiff {
  algo: typeof NORMALISATION_ALGO
  baseSha?: string
  headSha?: string
  files: ChangedFile[]
  /** Count of lines surviving normalisation (executable + defensive). */
  changedLines: number
  /** Count of head-side lines dropped by normalisation. */
  excludedLines: number
  /** True when nothing coverable changed — a formatting- or comment-only diff. */
  isEmpty: boolean
}

export interface NormaliseOptions {
  baseSha?: string
  headSha?: string
}

/**
 * Collapse insignificant whitespace: leading/trailing, and runs *between*
 * tokens — but never inside a string literal, where spacing is data. This is
 * the canonical text form used both for the hash and for detecting a
 * formatting-only edit.
 */
export function normaliseText(text: string): string {
  let out = ''
  let quote: string | null = null
  let pendingSpace = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (quote) {
      out += ch
      if (ch === '\\') {
        const next = text[i + 1]
        if (next !== undefined) { out += next; i += 1 }
      } else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      if (pendingSpace && out !== '') out += ' '
      pendingSpace = false
      out += ch
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t') { pendingSpace = true; continue }
    if (pendingSpace && out !== '') out += ' '
    pendingSpace = false
    out += ch
  }
  return out
}

/**
 * Pairing key for formatting-only detection: all whitespace outside string
 * literals removed, so `const a=1` and `const a = 1` collapse together while
 * `"hello  world"` and `"hello world"` stay distinct.
 */
export function formattingKey(text: string): string {
  return normaliseText(text).replace(/(?:"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`)|\s+/g, (m) =>
    m.trim() === '' ? '' : m,
  )
}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/
const NEW_PATH = /^\+\+\+ (?:b\/)?(.+?)(?:\t.*)?$/
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/**
 * Parse a unified diff and drop everything that cannot be exercised.
 *
 * Only head-side lines are considered: a deleted line has no code to run, and
 * a deleted file has nothing to cover.
 */
export function normaliseDiff(patch: string, options: NormaliseOptions = {}): NormalisedDiff {
  const files: ChangedFile[] = []
  let excluded = 0
  let current: ChangedFile | null = null
  let headLine = 0
  let inHunk = false

  // Buffered per hunk: an added line that exactly reproduces a removed line
  // once whitespace is normalised is a reformat, not a change (US-1 AC4).
  type Pending = { file: ChangedFile; line: number; text: string; class: StaticLineClass }
  let added: Pending[] = []
  let removed: string[] = []

  const flushHunk = () => {
    const pool = new Map<string, number>()
    for (const r of removed) pool.set(r, (pool.get(r) ?? 0) + 1)
    for (const a of added) {
      const key = formattingKey(a.text)
      const remaining = pool.get(key) ?? 0
      if (remaining > 0) {
        pool.set(key, remaining - 1)
        excluded += 1
        continue
      }
      a.file.lines.push({ line: a.line, text: a.text, class: a.class })
    }
    added = []
    removed = []
  }

  for (const raw of patch.split('\n')) {
    const fileHeader = FILE_HEADER.exec(raw)
    if (fileHeader) {
      flushHunk()
      current = null
      inHunk = false
      continue
    }

    if (raw.startsWith('+++ ')) {
      flushHunk()
      const m = NEW_PATH.exec(raw)
      const path = m?.[1]
      // `/dev/null` on the head side means the file was deleted; a file that
      // is not code has nothing to exercise and never enters the diff.
      const gate = path && path !== '/dev/null' ? gateability(path) : { kind: 'not-code' as const }
      current = gate.kind === 'not-code' || !path
        ? null
        : {
            path,
            language: gate.kind === 'supported' ? gate.language : null,
            ...(gate.kind === 'unsupported' ? { unsupportedLanguage: gate.language } : {}),
            lines: [],
          }
      if (current) files.push(current)
      inHunk = false
      continue
    }

    if (raw.startsWith('--- ')) continue

    const hunk = HUNK.exec(raw)
    if (hunk) {
      flushHunk()
      headLine = Number(hunk[1])
      inHunk = true
      continue
    }

    if (!inHunk || !current) continue

    if (raw.startsWith('+')) {
      const text = raw.slice(1)
      const classification = classifyLine(text, current.language ?? fallbackRules(current))
      if (classification.class === 'excluded') excluded += 1
      else added.push({ file: current, line: headLine, text: normaliseText(text), class: classification.class })
      headLine += 1
    } else if (raw.startsWith('-')) {
      // deleted line: no head-side line number to advance, but its content is
      // needed to recognise a formatting-only replacement.
      removed.push(formattingKey(raw.slice(1)))
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file"
    } else if (raw.startsWith(' ') || raw === '') {
      headLine += 1
    } else {
      // Anything else (index lines, mode changes, binary markers) ends the hunk.
      flushHunk()
      inHunk = false
    }
  }
  flushHunk()

  const kept = files.filter((f) => f.lines.length > 0)
  const changedLines = kept.reduce((n, f) => n + f.lines.length, 0)

  return {
    algo: NORMALISATION_ALGO,
    ...(options.baseSha !== undefined ? { baseSha: options.baseSha } : {}),
    ...(options.headSha !== undefined ? { headSha: options.headSha } : {}),
    files: kept,
    changedLines,
    excludedLines: excluded,
    isEmpty: changedLines === 0,
  }
}

/**
 * `diff_hash` — SHA-256 over the canonical form of the normalised diff.
 *
 * Deliberately excludes base/head sha: the hash binds evidence to *content*,
 * so a rebase or a force-push that preserves the change keeps the story fresh.
 */
export function diffHash(diff: NormalisedDiff): string {
  const canonical = {
    algo: diff.algo,
    files: [...diff.files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => ({
        path: f.path,
        lines: [...f.lines]
          .sort((a, b) => a.line - b.line)
          .map((l) => ({ line: l.line, text: l.text })),
      })),
  }
  return sha256(canonicalJson(canonical))
}

/**
 * An unsupported language still needs its comments and brackets stripped, or
 * the diff fills with noise. The rule set closest to its comment syntax is
 * good enough for exclusion; nothing else depends on it.
 */
const HASH_COMMENT_LANGS = new Set(['ruby', 'shell', 'perl', 'r', 'elixir'])

function fallbackRules(file: ChangedFile): Language | null {
  if (!file.unsupportedLanguage) return null
  return HASH_COMMENT_LANGS.has(file.unsupportedLanguage) ? 'py' : 'ts'
}

/** All coverable lines, flattened — the input to the coverage gate. */
export function changedLinesOf(diff: NormalisedDiff): Array<ChangedLine & { file: string }> {
  return diff.files.flatMap((f) => f.lines.map((l) => ({ ...l, file: f.path })))
}
