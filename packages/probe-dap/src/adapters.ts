import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Language } from '@swe-verify/core'
import type { PathMapping } from './pathmap.js'

/**
 * The adapter registry — NFR-12: "supported languages declared explicitly;
 * unsupported languages refuse rather than degrade".
 *
 * Each entry says how to bring the application up with a debug port open, and
 * what to send once a DAP client connects. The launch flags are the
 * week-eaters from TDD §14.2: bound to loopback by default, invisible from
 * outside a container, and silently wrong rather than loudly broken.
 */

export interface DebuggeeCommand {
  command: string
  args: string[]
  env: Record<string, string>
}

/** Environment, injected rather than read from the process (testability). */
export type AdapterEnv = Record<string, string | undefined>

export interface ConfigureParams {
  program: string
  /** Where the program runs. */
  cwd: string
  /**
   * Where the adapter is looked for. A project virtualenv or a vendored
   * adapter lives at the repository root, not next to the entry point.
   */
  repoRoot: string
  port: number
  pathMapping: PathMapping | null
  env?: AdapterEnv
  /**
   * How the adapter should start the program. A real repository is mostly
   * library packages with no `main`, and what exercises those is their tests —
   * so `test` is not an afterthought, it is how most code gets driven.
   */
  mode?: string
  /** Arguments for the launched binary, e.g. ['-test.run', 'TestThing']. */
  args?: string[]
}

export interface AdapterAvailability {
  available: boolean
  version?: string
  detail: string
  remedy?: string
}

export interface AdapterSpec {
  language: Language
  /** The upstream adapter this maps to. */
  name: string
  /** `attach` for a debuggee that listens; `launch` for an adapter that starts it. */
  configure: 'attach' | 'launch'
  debuggee(params: ConfigureParams): DebuggeeCommand
  configureArgs(params: ConfigureParams): Record<string, unknown>
  detect(root?: string, env?: AdapterEnv): AdapterAvailability
  /**
   * How to start the program with no debugger attached.
   *
   * Not having an adapter means this language cannot be *gated*; it does not
   * mean the app cannot be *run*. Conflating the two meant a Node app could
   * not have its lifecycle managed by the harness at all, and two agents
   * independently worked around it by starting the server by hand and
   * pointing a `kind: "none"` fixture at it — a worse plan describing the
   * same run. The changed lines report SV016 either way.
   */
  plain(params: PlainParams): DebuggeeCommand
}

export interface PlainParams {
  program: string
  cwd: string
  args: readonly string[]
  env: AdapterEnv
}

function tryRun(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 }).trim()
  } catch {
    return null
  }
}

/** The first Python on this machine that can actually import debugpy. */
export function findPython(cwd = process.cwd(), env: AdapterEnv = process.env): { python: string; version: string } | null {
  const candidates = [
    env.SWE_VERIFY_PYTHON,
    join(cwd, '.venv', 'bin', 'python'),
    join(cwd, 'venv', 'bin', 'python'),
    'python3',
    'python',
  ].filter((c): c is string => Boolean(c))

  for (const python of candidates) {
    const version = tryRun(python, ['-c', 'import debugpy; print(debugpy.__version__)'])
    if (version) return { python, version }
  }
  return null
}

export function findDelve(env: AdapterEnv = process.env): { dlv: string; version: string } | null {
  const candidates = [env.SWE_VERIFY_DLV, join(env.HOME ?? process.env.HOME ?? '', 'go', 'bin', 'dlv'), 'dlv']
    .filter((c): c is string => Boolean(c))
  for (const dlv of candidates) {
    const version = tryRun(dlv, ['version'])
    if (version) return { dlv, version: version.split('\n')[0]!.trim() }
  }
  return null
}

const debugpyAdapter: AdapterSpec = {
  language: 'py',
  name: 'debugpy',
  configure: 'attach',
  debuggee: ({ program, repoRoot, port, env }) => {
    const found = findPython(repoRoot, env ?? process.env)
    return {
      command: found?.python ?? 'python3',
      // `--wait-for-client` is what makes a run deterministic: without it the
      // program can finish before the probes are installed, and the gate then
      // blocks a change that ran perfectly well.
      args: ['-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--wait-for-client', program],
      env: { PYTHONUNBUFFERED: '1' },
    }
  },
  configureArgs: ({ pathMapping }) => ({
    // `justMyCode: false` so a probe inside a dependency still binds; the
    // diff decides what is instrumented, not the debugger's opinion of whose
    // code it is.
    justMyCode: false,
    ...(pathMapping
      ? { pathMappings: [{ localRoot: pathMapping.localRoot, remoteRoot: pathMapping.remoteRoot }] }
      : {}),
  }),
  plain: ({ program, args }) => ({ command: 'python3', args: [program, ...args], env: {} }),
  detect: (root, env) => {
    const found = findPython(root, env ?? process.env)
    return found
      ? { available: true, version: found.version, detail: `debugpy ${found.version} (${found.python})` }
      : {
          available: false,
          detail: 'debugpy is not importable by any python on PATH',
          remedy: 'pip install debugpy, and inside the container image too — it must be importable where the app runs.',
        }
  },
}

/** Launch modes `dlv dap` accepts. */
const DELVE_MODES = ['debug', 'test', 'exec', 'replay', 'core'] as const

const delveAdapter: AdapterSpec = {
  language: 'go',
  name: 'delve',
  configure: 'launch',
  debuggee: ({ port, env }) => {
    const found = findDelve(env ?? process.env)
    return {
      command: found?.dlv ?? 'dlv',
      // `dlv dap` is a DAP server that launches the program itself, so the
      // debuggee command here starts the adapter, not the app.
      args: ['dap', '--listen', `127.0.0.1:${port}`],
      env: {},
    }
  },
  configureArgs: ({ program, cwd, pathMapping, mode, args }) => {
    const launch = mode ?? 'debug'
    if (!(DELVE_MODES as readonly string[]).includes(launch)) {
      throw new TypeError(`delve has no launch mode "${launch}" (supported: ${DELVE_MODES.join(', ')})`)
    }
    return {
      request: 'launch',
      mode: launch,
      program,
      cwd,
      ...(args?.length ? { args } : {}),
      ...(pathMapping
        ? { substitutePath: [{ from: pathMapping.localRoot, to: pathMapping.remoteRoot }] }
        : {}),
    }
  },
  plain: ({ program, args }) => ({
    command: 'go',
    args: args.includes('-test.run') ? ['test', program || './...', ...args] : ['run', program || '.', ...args],
    env: {},
  }),
  detect: (_root, env) => {
    const found = findDelve(env ?? process.env)
    return found
      ? { available: true, version: found.version, detail: `${found.version} (${found.dlv})` }
      : {
          available: false,
          detail: 'delve (dlv) is not on PATH',
          remedy: 'go install github.com/go-delve/delve/cmd/dlv@latest; in a container it also needs --security-opt=seccomp=unconfined for ptrace.',
        }
  },
}

/**
 * js-debug and java-debug are declared but not yet vendored. They report
 * unavailable rather than falling back to log-scraping: a gate that degrades
 * is flaky, and flaky gates get bypassed (D3).
 */
const jsDebugAdapter: AdapterSpec = {
  language: 'ts',
  name: 'js-debug',
  configure: 'attach',
  debuggee: ({ program, port }) => ({
    command: 'node',
    // Loopback by default, and therefore invisible from outside a container:
    // the 0.0.0.0 host is mandatory, not a nicety (TDD §14.2).
    args: [`--inspect=0.0.0.0:${port}`, program],
    env: {},
  }),
  configureArgs: ({ port, pathMapping }) => ({
    type: 'pwa-node',
    request: 'attach',
    port,
    ...(pathMapping ? { localRoot: pathMapping.localRoot, remoteRoot: pathMapping.remoteRoot } : {}),
  }),
  plain: ({ program, args }) => ({ command: 'node', args: [program, ...args], env: {} }),
  detect: (root, env) => {
    const bundled = (env ?? process.env).SWE_VERIFY_JS_DEBUG
      ?? (root ? join(root, 'node_modules', '@vscode', 'js-debug', 'src', 'dapDebugServer.js') : '')
    if (bundled && existsSync(bundled)) {
      return { available: true, detail: `js-debug at ${bundled}` }
    }
    return {
      available: false,
      detail: 'js-debug (the DAP server for Node/TypeScript) is not vendored in this build',
      remedy: 'Point SWE_VERIFY_JS_DEBUG at a dapDebugServer.js. Node\'s own --inspect speaks CDP, not DAP, so it cannot be used directly.',
    }
  },
}

const javaDebugAdapter: AdapterSpec = {
  language: 'java',
  name: 'java-debug',
  configure: 'attach',
  debuggee: ({ program, port }) => ({
    command: 'java',
    // Since JDK 9 JDWP binds local-only; the `*:` prefix is mandatory.
    args: [`-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${port}`, '-jar', program],
    env: {},
  }),
  configureArgs: ({ port }) => ({ hostName: '127.0.0.1', port }),
  plain: ({ program, args }) => ({ command: 'java', args: program.endsWith('.jar') ? ['-jar', program, ...args] : [program, ...args], env: {} }),
  detect: (_root, env) => {
    const jar = (env ?? process.env).SWE_VERIFY_JAVA_DEBUG
    if (jar && existsSync(jar)) return { available: true, detail: `java-debug at ${jar}` }
    return {
      available: false,
      detail: 'java-debug (com.microsoft.java.debug.plugin) is not vendored in this build',
      remedy: 'Point SWE_VERIFY_JAVA_DEBUG at a java-debug plugin jar.',
    }
  },
}

export const ADAPTERS: Record<Language, AdapterSpec> = {
  py: debugpyAdapter,
  go: delveAdapter,
  ts: jsDebugAdapter,
  java: javaDebugAdapter,
}

export function adapterFor(language: Language): AdapterSpec {
  return ADAPTERS[language]
}

/** What `doctor` reports: one row per declared language (FR-14, NFR-12). */
export function adapterReport(root?: string, env?: AdapterEnv): Array<{ language: Language; name: string } & AdapterAvailability> {
  return Object.values(ADAPTERS).map((spec) => ({
    language: spec.language,
    name: spec.name,
    ...spec.detect(root, env),
  }))
}
