import { describe, expect, it } from 'vitest'
import { adapterFor } from '../../../src/probe-dap/adapters.js'

/**
 * Launch configuration per language. A real Go repository is a tree of library
 * packages with no `main` in sight, so "run the program" is the wrong verb:
 * the thing that exercises a library package is its tests. Delve's DAP server
 * launches those directly with `mode: "test"`.
 */

const go = adapterFor('go')
const params = (over = {}) => ({
  program: './pkg/services/thing',
  cwd: '/repo',
  repoRoot: '/repo',
  port: 5000,
  pathMapping: null,
  ...over,
})

describe('the go adapter', () => {
  it('launches a main package for debugging by default', () => {
    expect(go.configureArgs(params())).toMatchObject({ request: 'launch', mode: 'debug' })
  })

  it('launches a package\'s tests when the fixture asks for it', () => {
    expect(go.configureArgs(params({ mode: 'test' }))).toMatchObject({ mode: 'test', program: './pkg/services/thing' })
  })

  it('passes arguments through to the binary under test', () => {
    const args = go.configureArgs(params({ mode: 'test', args: ['-test.run', 'TestThing'] }))
    expect(args.args).toEqual(['-test.run', 'TestThing'])
  })

  it('omits args entirely when none are given, rather than sending an empty list', () => {
    expect(go.configureArgs(params())).not.toHaveProperty('args')
  })

  it('refuses a mode delve does not have, instead of passing it through', () => {
    expect(() => go.configureArgs(params({ mode: 'vibes' }))).toThrow(/vibes/)
  })

  it('still maps paths when running tests', () => {
    const args = go.configureArgs(params({ mode: 'test', pathMapping: { localRoot: '/repo', remoteRoot: '/app' } }))
    expect(args.substitutePath).toEqual([{ from: '/repo', to: '/app' }])
  })
})

describe('the python adapter', () => {
  it('ignores a mode it has no concept of', () => {
    const py = adapterFor('py')
    expect(py.configureArgs(params({ mode: 'test' }))).not.toHaveProperty('mode')
  })
})
