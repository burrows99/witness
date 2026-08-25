import { canonicalJson, sha256 } from './canonical.js'
import type { Story } from './types.js'

/**
 * Sealing — TDD §7.1.
 *
 * The story is hashed over its canonical form and the hash is stored inside
 * it. That is what makes a story checkable by a party that did not produce
 * it: the paid vault re-computes the seal server-side, and the difference
 * between storage and evidence is exactly that recomputation.
 */
export function sealStory(story: Story): Story {
  const { seal: _existing, ...unsealed } = story
  return {
    ...story,
    seal: { algo: 'sha256', value: sha256(canonicalJson(unsealed)), over: 'jcs(story minus seal)' },
  }
}

export function verifySeal(story: Story): boolean {
  const seal = story.seal
  if (!seal || seal.algo !== 'sha256') return false
  const { seal: _seal, ...unsealed } = story
  return sha256(canonicalJson(unsealed)) === seal.value
}
