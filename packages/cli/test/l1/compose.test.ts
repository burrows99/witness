import { describe, expect, it } from 'vitest'
import { composeArgs, composeDownArgs, composeCommand, resolveComposeUrl } from '../../src/runner/compose.js'

/**
 * L1 — bringing a real stack up.
 *
 * Until now a plan could only start a single process under a debugger, which
 * covers a library or a test binary but not an application: real apps come up
 * as several services with a database behind them. A change whose evidence
 * should be "here is the app working" could not be filmed at all, so every
 * plan fell back to filming a test run — which proves the code executed, not
 * that anyone could use the result.
 *
 * The lifecycle has to be exact. A stack left running poisons the next run
 * with stale state, and a stack torn down without its volumes leaves a
 * database that makes the following run pass for the wrong reason.
 */

describe('composeCommand — v2 plugin, then the standalone binary', () => {
  it('prefers `docker compose`, the form that is current', () => {
    expect(composeCommand(() => true)).toEqual({ file: 'docker', prefix: ['compose'] })
  })

  it('falls back to docker-compose where only the old binary exists', () => {
    expect(composeCommand((cmd) => cmd === 'docker-compose')).toEqual({ file: 'docker-compose', prefix: [] })
  })

  it('reports neither being present rather than failing later at spawn', () => {
    expect(composeCommand(() => false)).toBeNull()
  })
})

describe('composeArgs — bringing the stack up', () => {
  const base = { file: 'fixtures/docker-compose.yml', project: 'witness-01JB7QK' }

  it('names the compose file and an isolated project, so runs cannot collide', () => {
    const args = composeArgs(base)
    expect(args).toContain('-f')
    expect(args).toContain('fixtures/docker-compose.yml')
    expect(args).toContain('-p')
    expect(args).toContain('witness-01JB7QK')
  })

  it('waits for the stack rather than returning the moment containers exist', () => {
    // `up -d` returns once containers are created, not once they serve. A
    // plan that starts driving then is racing its own fixture.
    const args = composeArgs(base)
    expect(args).toContain('up')
    expect(args).toContain('-d')
    expect(args).toContain('--wait')
  })

  it('rebuilds when the plan says the image is built from this repo', () => {
    expect(composeArgs({ ...base, build: true })).toContain('--build')
    expect(composeArgs(base)).not.toContain('--build')
  })
})

describe('composeDownArgs — leaving nothing behind', () => {
  const base = { file: 'fixtures/docker-compose.yml', project: 'witness-01JB7QK' }

  it('removes volumes, so the next run does not inherit this run state', () => {
    // A database that survives is the classic way a suite passes for the
    // wrong reason: the row the assertion wants is already there.
    expect(composeDownArgs(base)).toContain('-v')
  })

  it('removes orphans, so a service dropped from the file is not left running', () => {
    expect(composeDownArgs(base)).toContain('--remove-orphans')
  })

  it('targets the same isolated project it brought up', () => {
    expect(composeDownArgs(base)).toContain('witness-01JB7QK')
  })
})

describe('resolveComposeUrl — where the app actually listens', () => {
  it('uses the plan baseUrl when it names one', () => {
    expect(resolveComposeUrl('http://localhost:3000', null)).toBe('http://localhost:3000')
  })

  it('substitutes the published port compose chose', () => {
    // Compose may map a container port to an ephemeral host port, and the
    // plan cannot know it in advance.
    expect(resolveComposeUrl('http://127.0.0.1:{port}', 54321)).toBe('http://127.0.0.1:54321')
  })

  it('leaves the placeholder alone when no port was discovered', () => {
    // Better a visibly wrong URL than a silently plausible one.
    expect(resolveComposeUrl('http://127.0.0.1:{port}', null)).toBe('http://127.0.0.1:{port}')
  })
})
