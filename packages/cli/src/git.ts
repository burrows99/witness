import { execFileSync } from 'node:child_process'
import { normaliseDiff, type NormalisedDiff } from '@swe-verify/core'
import { HarnessError, UsageError } from './errors.js'

/**
 * git, not GitHub.
 *
 * `git` is a local tool present wherever code is, so shelling out to it is
 * not host coupling (TDD §7.7). Only the three operations that touch a *host*
 * live behind `VcsProvider`.
 */

function git(cwd: string, args: string[]): string {
  try {
    // stderr is piped, not inherited: a probing call that fails (checking for
    // a branch that may not exist) must not print noise the user reads as an
    // error.
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ''
    // "unknown revision" is the user pointing at a base that does not exist —
    // a config problem (exit 3), not a harness failure (exit 4).
    if (/unknown revision|bad revision|ambiguous argument|not a valid object name/i.test(stderr)) {
      throw new UsageError(`git could not resolve a revision: ${stderr.trim()}`, 'Check --base names a commit or branch that exists locally.')
    }
    throw new HarnessError(`git ${args[0]} failed: ${stderr.trim() || (error as Error).message}`)
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'
  } catch {
    return false
  }
}

export function gitHeadSha(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']).trim()
}

export function mergeBase(cwd: string, ref: string): string {
  return git(cwd, ['merge-base', 'HEAD', ref]).trim()
}

/**
 * The diff a story is bound to: base..working tree, including uncommitted
 * changes so the same gate can run in pre-commit and in CI.
 *
 * `-U0` keeps hunks tight; the normaliser needs no surrounding context, and
 * context lines would only make the parse ambiguous. Renames are followed so
 * a moved file is not reported as wholly new.
 */
export function diffAgainst(cwd: string, base: string): NormalisedDiff {
  const headSha = safeHead(cwd)
  // Against the empty tree, `git diff` needs the index to see anything: an
  // untracked file is not part of any diff until it is added.
  if (base === EMPTY_TREE && !hasCommits(cwd)) {
    const patch = git(cwd, ['--no-pager', 'diff', '--no-color', '--no-ext-diff', '-U0', '--find-renames', '--cached', base])
    return normaliseDiff(patch, { baseSha: base, ...(headSha ? { headSha } : {}) })
  }
  const patch = git(cwd, ['--no-pager', 'diff', '--no-color', '--no-ext-diff', '-U0', '--find-renames', `${base}`])
  return normaliseDiff(patch, { baseSha: base, ...(headSha ? { headSha } : {}) })
}

function safeHead(cwd: string): string | undefined {
  try { return gitHeadSha(cwd) } catch { return undefined }
}

/**
 * Git's canonical empty tree. It is the honest base for a repository with no
 * commits yet: the change is "everything that exists".
 */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export function hasCommits(cwd: string): boolean {
  try {
    git(cwd, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/** The default base: the merge base with the repo's main branch, else HEAD. */
export function defaultBase(cwd: string, candidates = ['origin/main', 'origin/master', 'main', 'master']): string {
  if (!hasCommits(cwd)) return EMPTY_TREE
  for (const ref of candidates) {
    try {
      const base = git(cwd, ['merge-base', 'HEAD', ref]).trim()
      if (base) return base
    } catch { /* try the next candidate */ }
  }
  try { return git(cwd, ['rev-parse', 'HEAD~1']).trim() } catch { return gitHeadSha(cwd) }
}
