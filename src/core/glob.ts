/**
 * Minimal path globbing for scope matching. `core` stays dependency-light on
 * purpose — the gate has to run in CI with nothing installed (NFR-7) — and
 * scope patterns only ever need `**`, `*` and `?`.
 */
const SPECIAL = /[.+^${}()|[\]\\]/g

export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!
    if (ch === '*') {
      const doubled = pattern[i + 1] === '*'
      if (doubled) {
        const slashed = pattern[i + 2] === '/'
        i += slashed ? 2 : 1
        out += slashed ? '(?:.*/)?' : '.*'
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (ch === '?') { out += '[^/]'; continue }
    out += ch.replace(SPECIAL, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

const cache = new Map<string, RegExp>()

export function globMatch(path: string, pattern: string): boolean {
  let re = cache.get(pattern)
  if (!re) {
    re = globToRegExp(pattern)
    cache.set(pattern, re)
  }
  return re.test(path)
}

export function matchesScope(path: string, scope: { include: string[]; exclude?: string[] }): boolean {
  if (scope.exclude?.some((p) => globMatch(path, p))) return false
  return scope.include.some((p) => globMatch(path, p))
}
