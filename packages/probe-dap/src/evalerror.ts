/**
 * Recognising an adapter's "I could not evaluate that" output.
 *
 * When an interpolated expression cannot be resolved, adapters print their
 * own error *instead of* the log message. The probe then looks like it never
 * fired — indistinguishable from the line never running, which is the exact
 * signal the coverage gate depends on.
 *
 * The error is nonetheless proof the line ran: a log message is only
 * evaluated when the breakpoint is hit. Attributing the error back to the
 * probe that asked for the symbol turns a silent false block into a hit with
 * a recorded capture failure.
 */

export interface EvaluationError {
  symbol: string
  detail: string
}

const PATTERNS: RegExp[] = [
  /name '([A-Za-z_$][\w$]*)' is not defined/,                       // debugpy / CPython
  /could not find symbol value for ([A-Za-z_$][\w$]*)/,             // delve
  /([A-Za-z_$][\w$]*) cannot be resolved to a variable/,            // java-debug
  /ReferenceError: ([A-Za-z_$][\w$]*) is not defined/,              // js-debug
  /undefined: ([A-Za-z_$][\w$]*)/,                                  // go compiler-style
]

export function parseEvaluationError(text: string): EvaluationError | null {
  const line = text.trim()
  if (!line) return null
  for (const pattern of PATTERNS) {
    const match = pattern.exec(line)
    if (match?.[1]) return { symbol: match[1], detail: line }
  }
  return null
}
