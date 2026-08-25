/**
 * Reading arguments out of a plan.
 *
 * A plan is committed JSON, written by hand or by an agent. `String(value)`
 * would turn a mistake — an object where a string belongs — into a step that
 * types "[object Object]" into a form and reports success, and the gate would
 * then call that flow exercised. Refusing loudly, naming the argument, turns a
 * silent wrong action into a step error somebody can fix.
 */

export type PlanArgs = Record<string, unknown>

function fail(key: string, value: unknown, expected: string): never {
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  throw new TypeError(`plan argument "${key}" must be ${expected}, got ${actual}`)
}

export function readString(args: PlanArgs, key: string, fallback?: string): string {
  const value = args[key]
  if (value === undefined) {
    if (fallback !== undefined) return fallback
    throw new TypeError(`plan argument "${key}" is required`)
  }
  if (typeof value === 'string') return value
  // Numbers and booleans are what a JSON author writes for a query value or a
  // flag, and reading them as text is unambiguous.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return fail(key, value, 'a string')
}

export function readNumber(args: PlanArgs, key: string, fallback?: number): number {
  const value = args[key]
  if (value === undefined) {
    if (fallback !== undefined) return fallback
    throw new TypeError(`plan argument "${key}" is required`)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return fail(key, value, 'a number')
}

export function readBoolean(args: PlanArgs, key: string, fallback?: boolean): boolean {
  const value = args[key]
  if (value === undefined) {
    if (fallback !== undefined) return fallback
    throw new TypeError(`plan argument "${key}" is required`)
  }
  if (typeof value === 'boolean') return value
  return fail(key, value, 'a boolean')
}

/** Present and not null, without asserting its type. */
export function has(args: PlanArgs, key: string): boolean {
  return args[key] !== undefined && args[key] !== null
}
