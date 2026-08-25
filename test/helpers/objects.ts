/**
 * The same data with its keys in the opposite order.
 *
 * `{ k: value, ...obj }` looks like a reordering and is not: the spread puts
 * `k` back where it was, so a test written that way proves nothing. TypeScript
 * says so — "'k' is specified more than once" — which is why type-checking the
 * tests matters as much as type-checking the source.
 */
export function withReversedKeys<T>(value: T): T {
  return JSON.parse(JSON.stringify(reverseKeys(value))) as T
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record).reverse()) {
      out[key] = reverseKeys(record[key])
    }
    return out
  }
  return value
}
