import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Path mapping — failure #1 (TDD §14.2).
 *
 * DAP sets breakpoints by path. When the application runs in a container, the
 * path the debugger knows (`/app/src/a.py`) is not the path the repo has
 * (`/home/me/repo/src/a.py`), and a breakpoint set on the wrong path is
 * *accepted and never bound*. That looks identical to "the code never ran",
 * which is exactly the signal the coverage gate depends on — hence SV011 and
 * hence this being explicit rather than incidental.
 */

export interface PathMapping {
  /** Where the repository lives on this machine. */
  localRoot: string
  /** Where the same tree lives from the debuggee's point of view. */
  remoteRoot: string
}

export function toRemote(path: string, mapping: PathMapping | null, cwd: string): string {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path)
  if (!mapping) return absolute
  const rel = relative(resolve(mapping.localRoot), absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) return absolute
  // The remote may be POSIX while the host is Windows; joining with the local
  // separator would produce a path the adapter cannot match.
  return `${trimTrailing(mapping.remoteRoot)}/${rel.split(sep).join('/')}`
}

export function toLocal(path: string, mapping: PathMapping | null, cwd: string): string {
  if (!mapping) return isAbsolute(path) ? path : resolve(cwd, path)
  const remoteRoot = trimTrailing(mapping.remoteRoot)
  if (!path.startsWith(`${remoteRoot}/`)) return path
  return join(mapping.localRoot, path.slice(remoteRoot.length + 1))
}

/** Repo-relative, which is how a story records a file so it survives a move. */
export function toRepoRelative(path: string, repoRoot: string): string {
  const rel = relative(resolve(repoRoot), isAbsolute(path) ? path : resolve(repoRoot, path))
  return rel.split(sep).join('/')
}

function trimTrailing(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}
