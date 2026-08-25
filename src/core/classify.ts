/**
 * Line classification — PRD §7.5 / contracts §4.
 *
 * The ≤2% false-block target (NFR-2) is won or lost here: "every changed line
 * has a fired probe" is 100% line coverage on the diff, which would fire on
 * every catch block, guard clause and import. Classes make that survivable.
 *
 * Detection is pattern-based per language rather than AST-based (open question
 * Q1). `defensive` therefore defaults to the `warn` policy: a miss costs a
 * warning, not a false block.
 */

export type Language = 'ts' | 'py' | 'go' | 'java'

/** Classes assigned statically, from the diff text alone. */
export type StaticLineClass = 'excluded' | 'executable' | 'defensive'

/** Every class the gate can see, including the two assigned at run time. */
export type LineClass = StaticLineClass | 'waived' | 'unbound'

export type ExclusionReason = 'blank' | 'comment' | 'bracket' | 'import' | 'type-only'

export interface Classification {
  class: StaticLineClass
  reason?: ExclusionReason
}

const EXTENSIONS: Record<string, Language> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts',
  py: 'py', pyi: 'py',
  go: 'go',
  java: 'java',
}

/**
 * Code we recognise but deliberately refuse to gate: no trustworthy DAP
 * adapter, and a gate that degrades to log-scraping is flaky — flaky gates
 * get bypassed (D3). Naming them is what makes the refusal visible instead of
 * silent.
 */
const UNSUPPORTED_CODE: Record<string, string> = {
  rb: 'ruby', rs: 'rust', php: 'php', cs: 'c#', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cc: 'c++', cpp: 'c++', hpp: 'c++',
  scala: 'scala', ex: 'elixir', exs: 'elixir', erl: 'erlang', clj: 'clojure',
  dart: 'dart', lua: 'lua', pl: 'perl', r: 'r', sh: 'shell', bash: 'shell',
  sql: 'sql', vue: 'vue', svelte: 'svelte',
}

/** How a changed file relates to the gate. */
export type Gateability =
  | { kind: 'supported'; language: Language }
  | { kind: 'unsupported'; language: string }
  | { kind: 'not-code' }

/**
 * A file that is not code cannot be exercised, so it never enters the diff:
 * "a gate that fires on README typos is disabled within a week" (TDD §14.3).
 */
export function gateability(path: string): Gateability {
  const language = languageOf(path)
  if (language) return { kind: 'supported', language }
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const unsupported = UNSUPPORTED_CODE[ext]
  return unsupported ? { kind: 'unsupported', language: unsupported } : { kind: 'not-code' }
}

/** The languages the harness will instrument. Anything else refuses (NFR-12). */
export const SUPPORTED_LANGUAGES: readonly Language[] = ['ts', 'py', 'go', 'java']

export function languageOf(path: string): Language | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSIONS[ext] ?? null
}

const BRACKET_ONLY = /^[{}()[\];,]+$/
const BLOCK_COMMENT_LANGS = new Set<Language>(['ts', 'go', 'java'])

interface LanguageRules {
  lineComment: string[]
  imports: RegExp[]
  typeOnly: RegExp[]
  defensive: RegExp[]
}

const RULES: Record<Language, LanguageRules> = {
  ts: {
    lineComment: ['//'],
    imports: [/^import[\s{*'"]/, /^export\s+(\*|type\s|\{[^}]*\}\s*from)/, /^const\s+\{?[\w\s,}]*\}?\s*=\s*require\(/],
    typeOnly: [/^(export\s+)?(type|interface)\s+\w/, /^(export\s+)?declare\s/],
    defensive: [/^\}?\s*catch\b/, /^throw\b/, /\bthrow\s+new\b/, /^\}?\s*finally\b/],
  },
  py: {
    lineComment: ['#'],
    imports: [/^import\s/, /^from\s+\S+\s+import\s/],
    typeOnly: [/^(\w+):\s*(TypeAlias|Type\[)/, /^class\s+\w+\(Protocol\)/],
    defensive: [/^except\b/, /^raise\b/, /^finally\s*:/, /^assert\b/],
  },
  go: {
    lineComment: ['//'],
    imports: [/^import\s/, /^package\s/, /^\s*"[^"]+"$/],
    typeOnly: [/^type\s+\w+\s+(interface|struct)\b/],
    // `t.Error`/`t.Fatal` and friends are the failure branch of an assertion.
    // A passing test leaves them cold by definition, so reporting them as
    // "changed line never executed" asks for something impossible: an agent
    // was blocked by five of them and the only offered remedies were to reach
    // the line or waive it, both of which mean weakening a test that works.
    defensive: [/^if\s+err\s*!=\s*nil\b/, /^return\s+.*\berr\b\s*$/, /^panic\(/, /^log\.Fatal/, /^t\.(Error|Fatal|Skip)/, /^\w+\.(Errorf?|Fatalf?)\(/],
  },
  java: {
    lineComment: ['//'],
    imports: [/^import\s/, /^package\s/],
    typeOnly: [/^(public\s+|private\s+)?interface\s+\w/, /^@\w+$/],
    defensive: [/^\}?\s*catch\s*\(/, /^throw\s/, /^\}?\s*finally\b/],
  },
}

/**
 * Classify one line of changed code. `text` is the raw head-side content;
 * indentation is insignificant.
 */
export function classifyLine(text: string, language: Language | null): Classification {
  const t = text.trim()
  if (t === '') return { class: 'excluded', reason: 'blank' }
  if (BRACKET_ONLY.test(t)) return { class: 'excluded', reason: 'bracket' }

  // An unknown language is classified conservatively: everything that is not
  // blank or bare punctuation counts as executable. Refusing to gate an
  // unsupported language is a separate decision, taken by `doctor` (NFR-12).
  if (language === null) return { class: 'executable' }

  const rules = RULES[language]

  for (const marker of rules.lineComment) {
    // `#` starts a comment in Python but is a private field in JS/TS.
    if (t.startsWith(marker)) return { class: 'excluded', reason: 'comment' }
  }
  if (BLOCK_COMMENT_LANGS.has(language) && (t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/'))) {
    return { class: 'excluded', reason: 'comment' }
  }
  if (rules.imports.some((re) => re.test(t))) return { class: 'excluded', reason: 'import' }
  if (rules.typeOnly.some((re) => re.test(t))) return { class: 'excluded', reason: 'type-only' }
  if (rules.defensive.some((re) => re.test(t))) return { class: 'defensive' }

  return { class: 'executable' }
}
