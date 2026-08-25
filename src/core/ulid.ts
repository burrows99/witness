import { randomBytes } from 'node:crypto'

/**
 * ULID — the run id.
 *
 * Client-generated, so a retried CI job re-uploads the same id and the vault
 * treats it as a no-op rather than a duplicate. Lexicographically sortable by
 * time, so "the latest run" is a sort of directory names rather than a query.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U
const TIME_LENGTH = 10
const RANDOM_LENGTH = 16

export function ulid(now: Date = new Date()): string {
  return encodeTime(now.getTime()) + encodeRandom()
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
}

export function ulidTime(value: string): Date | null {
  if (!isUlid(value)) return null
  let time = 0
  for (const char of value.slice(0, TIME_LENGTH)) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) return null
    time = time * 32 + index
  }
  return new Date(time)
}

function encodeTime(time: number): string {
  let out = ''
  let remaining = time
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    out = ALPHABET[remaining % 32] + out
    remaining = Math.floor(remaining / 32)
  }
  return out
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LENGTH)
  let out = ''
  for (let i = 0; i < RANDOM_LENGTH; i += 1) out += ALPHABET[bytes[i]! % 32]
  return out
}
