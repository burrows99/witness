/**
 * JSON Schemas for the three artefacts. Kept as objects rather than files so
 * the CLI stays a single binary with no runtime asset loading (NFR-6).
 *
 * Additional properties are permitted everywhere on purpose: an old CLI
 * reading a story written by a newer one must ignore unknown minor fields
 * rather than refuse it (NFR-9). Refusal is reserved for an unknown *major*.
 */

const sha256Pattern = '^sha256:[0-9a-f]{64}$'

export const planSchema = {
  $id: 'swe-verify/plan@1',
  type: 'object',
  required: ['schema', 'id', 'intent', 'scope', 'steps', 'assertions'],
  properties: {
    schema: { const: 'swe-verify/plan@1' },
    id: { type: 'string', minLength: 1, pattern: '^[a-zA-Z0-9._-]+$' },
    intent: { type: 'string', minLength: 1 },
    domain: { type: 'string' },
    scope: {
      type: 'object',
      required: ['include'],
      properties: {
        include: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        exclude: { type: 'array', items: { type: 'string' } },
      },
    },
    fixture: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { enum: ['compose', 'none', 'process'] },
        file: { type: 'string' },
        language: { type: 'string' },
        program: { type: 'string' },
        baseUrl: { type: 'string' },
        // For a job or script fixture: wait for the process to finish before
        // sealing, rather than after the last step. A server never exits, so
        // this is opt-in.
        awaitExit: { type: 'boolean' },
        // How the adapter starts the program. For Go, `test` runs a package's
        // tests, which is the only way to drive a library package.
        mode: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        attach: {
          type: 'object',
          properties: { host: { type: 'string' }, port: { type: 'integer' } },
        },
        ready: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              http: { type: 'string' },
              status: { type: 'integer' },
              timeoutMs: { type: 'integer', minimum: 0 },
              cmd: { type: 'string' },
            },
          },
        },
        seed: { type: 'array', items: { type: 'string' } },
        env: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['seq', 'driver', 'action'],
        properties: {
          seq: { type: 'integer', minimum: 1 },
          driver: { type: 'string', minLength: 1 },
          action: { type: 'string', minLength: 1 },
          args: { type: 'object' },
        },
      },
    },
    assertions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'afterStep', 'expect'],
        properties: {
          id: { type: 'string', minLength: 1 },
          kind: { type: 'string', minLength: 1 },
          afterStep: { type: 'integer', minimum: 1 },
          query: { type: 'string' },
          expect: { type: 'object' },
        },
      },
    },
    coverage: {
      type: 'object',
      properties: {
        policy: { enum: ['all-executable'] },
        waivers: {
          type: 'array',
          items: {
            type: 'object',
            // A waiver with no reason and no expiry is a permanent hole.
            required: ['file', 'lines', 'reason', 'expires'],
            properties: {
              file: { type: 'string', minLength: 1 },
              lines: { type: 'string', pattern: '^\\d+(-\\d+)?$' },
              reason: { type: 'string', minLength: 1 },
              // ISO date. Kept as a pattern rather than an ajv format so
              // `core` carries one dependency instead of two (NFR-6).
              expires: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            },
          },
        },
      },
    },
  },
} as const

const baseEventProps = {
  seq: { type: 'integer', minimum: 0 },
  tier: { enum: ['browser', 'server', 'data', 'harness'] },
  trace_id: { type: 'string' },
  span_id: { type: 'string' },
  parent_span_id: { type: 'string' },
  step_seq: { type: 'integer' },
  wall: { type: 'string' },
  mono_ns: { type: 'number' },
}
const baseRequired = ['seq', 'tier', 'trace_id', 'wall', 'mono_ns', 'type']

const event = (type: string, props: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  required: [...baseRequired, ...required],
  properties: { ...baseEventProps, type: { const: type }, ...props },
})

export const storySchema = {
  $id: 'swe-verify/story@1',
  type: 'object',
  required: ['schema', 'run_id', 'plan_id', 'plan_sha256', 'diff', 'env', 'started_at', 'events', 'coverage', 'assertions', 'artifacts'],
  properties: {
    schema: { const: 'swe-verify/story@1' },
    run_id: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
    plan_id: { type: 'string', minLength: 1 },
    plan_sha256: { type: 'string', pattern: sha256Pattern },
    diff: {
      type: 'object',
      required: ['hash', 'algo', 'base_sha', 'head_sha'],
      properties: {
        hash: { type: 'string', pattern: sha256Pattern },
        algo: { type: 'string' },
        base_sha: { type: 'string' },
        head_sha: { type: 'string' },
        files: { type: 'integer', minimum: 0 },
        changed_lines: { type: 'integer', minimum: 0 },
      },
    },
    vcs: {
      type: 'object',
      properties: { provider: { type: 'string' }, change_id: { type: 'string' }, actor: { type: 'string' } },
    },
    env: {
      type: 'object',
      required: ['cli', 'runner'],
      properties: { cli: { type: 'string' }, os: { type: 'string' }, runner: { type: 'string' }, domain: { type: 'string' }, breakpoints: { type: 'integer', minimum: 0 } },
    },
    started_at: { type: 'string' },
    sealed_at: { type: 'string' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        // A discriminated union: the `type` selects exactly one shape, so a
        // logpoint missing `vars` is a schema failure, not a tolerated gap.
        oneOf: [
          event('step', { driver: { type: 'string' }, action: { type: 'string' }, args: { type: 'object' }, status: { enum: ['ok', 'error'] }, error: { type: 'string' } }, ['driver', 'action', 'status']),
          event('logpoint', { probe_id: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' }, vars: { type: 'object' }, hit: { type: 'integer' } }, ['probe_id', 'file', 'line', 'vars', 'hit']),
          event('span', { name: { type: 'string' }, kind: { enum: ['client', 'server', 'internal'] }, attrs: { type: 'object' }, duration_ms: { type: 'number' } }, ['name', 'kind', 'duration_ms']),
          event('artifact', { artifact_index: { type: 'integer', minimum: 0 } }, ['artifact_index']),
          event('assertion', { assertion_id: { type: 'string' }, status: { enum: ['pass', 'fail'] } }, ['assertion_id', 'status']),
          event('diagnostic', { code: { type: 'string' }, message: { type: 'string' } }, ['code', 'message']),
        ],
      },
    },
    coverage: {
      type: 'object',
      required: ['policy', 'lines', 'summary'],
      properties: {
        policy: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'line', 'class'],
            properties: {
              file: { type: 'string' },
              line: { type: 'integer', minimum: 1 },
              class: { enum: ['excluded', 'executable', 'defensive', 'waived', 'unbound'] },
              probe_id: { type: 'string' },
              verified: { type: 'boolean' },
              adapter_line: { type: 'integer' },
              hits: { type: 'integer', minimum: 0 },
              reason: { type: 'string' },
              expires: { type: 'string' },
            },
          },
        },
        summary: { type: 'object' },
      },
    },
    assertions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status'],
        properties: {
          id: { type: 'string' },
          status: { enum: ['pass', 'fail', 'skipped'] },
          event_seq: { type: 'integer' },
          diff: { type: 'string' },
        },
      },
    },
    artifacts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'path', 'sha256', 'bytes', 'readableBy'],
        properties: {
          kind: { type: 'string' },
          path: { type: 'string' },
          sha256: { type: 'string', pattern: sha256Pattern },
          bytes: { type: 'integer', minimum: 0 },
          readableBy: { type: 'array', minItems: 1, items: { enum: ['agent', 'human'] } },
          step_seq: { type: 'integer' },
        },
      },
    },
    diagnostics: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'severity', 'message'],
        properties: {
          code: { type: 'string' },
          severity: { enum: ['error', 'warn'] },
          message: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
        },
      },
    },
    seal: {
      type: 'object',
      required: ['algo', 'value', 'over'],
      properties: {
        algo: { const: 'sha256' },
        value: { type: 'string', pattern: sha256Pattern },
        over: { type: 'string' },
      },
    },
  },
} as const

export const configSchema = {
  $id: 'swe-verify/config@1',
  type: 'object',
  required: ['schema'],
  properties: {
    schema: { const: 'swe-verify/config@1' },
    domain: { type: 'string' },
    vcs: { enum: ['auto', 'github', 'gitlab', 'bitbucket', 'local'] },
    runner: { enum: ['local'] },
    artifactStore: { enum: ['fs', 'ci'] },
    telemetry: { enum: ['off', 'on'] },
    scope: {
      type: 'object',
      properties: {
        include: { type: 'array', items: { type: 'string' } },
        exclude: { type: 'array', items: { type: 'string' } },
        languages: { type: 'array', items: { type: 'string' } },
      },
    },
    coverage: {
      type: 'object',
      properties: {
        policy: { enum: ['all-executable'] },
        defensive: { enum: ['off', 'warn', 'require'] },
        waiverCapPct: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
    budgets: {
      type: 'object',
      properties: {
        runMs: { type: 'integer', minimum: 1000 },
        breakpointMs: { type: 'integer', minimum: 0 },
        artifactBytes: { type: 'integer', minimum: 0 },
        probeLines: { type: 'integer', minimum: 1 },
        // The adapter handshake, which for Go includes compiling the binary.
        launchMs: { type: 'integer', minimum: 1000 },
      },
    },
    bypass: {
      type: 'object',
      properties: {
        allowed: { type: 'boolean' },
        requiresReason: { type: 'boolean' },
        label: { type: 'string' },
      },
    },
    artifacts: {
      type: 'object',
      properties: { requireAgentReadable: { type: 'boolean' } },
    },
    redact: {
      type: 'object',
      properties: {
        keys: { type: 'array', items: { type: 'string' } },
        patterns: { type: 'array', items: { type: 'string' } },
        onUnknownBinary: { enum: ['drop', 'keep'] },
      },
    },
  },
} as const
