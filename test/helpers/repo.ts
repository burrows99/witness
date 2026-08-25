import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson, diffHash, normaliseDiff, sha256, type Plan, type Story } from '../../src/core/index.js'
import { run, type RunOptions } from '../../src/cli/index.js'

/** A disposable git repository with a witness workspace inside it. */
export class TestRepo {
  readonly dir: string

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'witness-l2-'))
    this.git('init', '-q', '-b', 'main')
    this.git('config', 'user.email', 'test@example.com')
    this.git('config', 'user.name', 'test')
    this.git('config', 'commit.gpgsign', 'false')
  }

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8' })
  }

  write(relPath: string, contents: string): void {
    const full = join(this.dir, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }

  commit(message: string): string {
    this.git('add', '-A')
    this.git('commit', '-q', '-m', message)
    return this.git('rev-parse', 'HEAD').trim()
  }

  writePlan(plan: Plan): { path: string; sha256: string } {
    const path = join('.witness', 'plans', `${plan.id}.plan.json`)
    this.write(path, `${JSON.stringify(plan, null, 2)}\n`)
    return { path, sha256: sha256(canonicalJson(plan)) }
  }

  /** The normalised diff of the working tree against `base`, as the gate sees it. */
  diff(base: string) {
    const patch = execFileSync('git', ['--no-pager', 'diff', '--no-color', '-U0', base], { cwd: this.dir, encoding: 'utf8' })
    return normaliseDiff(patch, { baseSha: base })
  }

  diffHash(base: string): string {
    return diffHash(this.diff(base))
  }

  writeStory(story: Story): string {
    const path = join('.witness', 'runs', story.run_id, 'story.json')
    this.write(path, `${JSON.stringify(story, null, 2)}\n`)
    return join(this.dir, path)
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}

export interface CliRun {
  code: number
  stdout: string
  stderr: string
  json<T = unknown>(): T
}

/** Invoke the CLI in-process, with a fully injected environment. */
export async function cli(repo: TestRepo, argv: string[], options: Partial<RunOptions> = {}): Promise<CliRun> {
  let stdout = ''
  let stderr = ''
  const code = await run({
    argv,
    cwd: repo.dir,
    env: { PATH: process.env.PATH, ...options.env },
    stdout: { write: (chunk: string) => { stdout += chunk; return true } } as unknown as NodeJS.WritableStream,
    stderr: { write: (chunk: string) => { stderr += chunk; return true } } as unknown as NodeJS.WritableStream,
    ...(options.now ? { now: options.now } : {}),
  })
  return {
    code,
    stdout,
    stderr,
    json<T>() {
      const source = stdout.trim() || stderr.trim()
      return JSON.parse(source.split('\n').pop() ?? '{}') as T
    },
  }
}

export function planFor(id: string, include: string[], over: Partial<Plan> = {}): Plan {
  return {
    schema: 'witness/plan@1',
    id,
    intent: `prove ${id}`,
    domain: 'fullstack',
    scope: { include },
    fixture: { kind: 'none' },
    steps: [{ seq: 1, driver: 'api', action: 'get', args: { path: '/' } }],
    assertions: [{ id: 'a1', kind: 'http-status', afterStep: 1, expect: { status: 200 } }],
    ...over,
  }
}

/** A hand-written story — the M0 release criterion says these must pass. */
export function storyFor(params: {
  planId: string
  planSha: string
  diffHash: string
  base: string
  head?: string
  lines: Array<{ file: string; line: number; hits?: number; verified?: boolean; class?: string }>
  assertions?: Story['assertions']
  runId?: string
}): Story {
  const lines = params.lines.map((l) => ({
    file: l.file,
    line: l.line,
    class: (l.class ?? 'executable') as 'executable',
    probe_id: `p${l.line}`,
    verified: l.verified ?? true,
    hits: l.hits ?? 1,
  }))
  return {
    schema: 'witness/story@1',
    run_id: params.runId ?? '01JB7QK3M9X2VYD8N4T6ZQWERT',
    plan_id: params.planId,
    plan_sha256: params.planSha,
    diff: {
      hash: params.diffHash,
      algo: 'normalised-v1',
      base_sha: params.base,
      head_sha: params.head ?? 'e'.repeat(40),
      files: new Set(lines.map((l) => l.file)).size,
      changed_lines: lines.length,
    },
    vcs: { provider: 'local' },
    env: { cli: '0.1.0', os: 'linux/arm64', runner: 'local', domain: 'fullstack' },
    started_at: '2026-08-24T10:11:02.401Z',
    sealed_at: '2026-08-24T10:11:19.883Z',
    events: [],
    coverage: {
      policy: 'all-executable',
      lines,
      summary: {
        executable: lines.length,
        fired: lines.filter((l) => l.hits > 0).length,
        unverified: lines.filter((l) => !l.verified).length,
        waived: 0,
        excluded: 0,
        defensive: 0,
      },
    },
    assertions: params.assertions ?? [{ id: 'a1', status: 'pass' }],
    artifacts: [],
    diagnostics: [],
  }
}
