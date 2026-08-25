import { DEFAULT_BRAND } from './brand.js'
import { Ajv, type ValidateFunction } from 'ajv'
import { configSchema, planSchema, storySchema } from './schemas.js'
import type { Config, Finding, Plan, ResolvedConfig, Story } from './types.js'

/**
 * Schema validation — the trust boundary.
 *
 * A story is an artefact an untrusted PR can influence (TDD §10.1). Nothing
 * reads a story field before it validates, and validation never executes
 * anything from the artefact.
 */

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; findings: Finding[] }

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })

const validators = {
  plan: ajv.compile(planSchema as object),
  story: ajv.compile(storySchema as object),
  config: ajv.compile(configSchema as object),
}

/**
 * Any brand, then the kind and the major. The name in front is deliberately
 * not checked: a document is identified by what it *is*, not by who wrote it,
 * so renaming the tool never orphans a plan or a story already committed.
 */
const SCHEMA_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\/(plan|story|config)@(\d+)$/

function fail(message: string, remedy: string): { ok: false; findings: Finding[] } {
  return { ok: false, findings: [{ code: 'SV002', severity: 'error', message, remedy }] }
}

/**
 * Check the `schema` discriminator before anything else. An unknown major is
 * refused outright rather than parsed best-effort (NFR-9): a newer story may
 * carry fields whose absence changes a verdict, and guessing turns a hard gate
 * into a soft one.
 */
function checkSchemaField(value: unknown, kind: 'plan' | 'story' | 'config', major: number) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${kind} is not a JSON object`, `Regenerate the ${kind} with the swe-verify CLI.`)
  }
  const schema = (value as Record<string, unknown>).schema
  if (typeof schema !== 'string') {
    return fail(`${kind} is missing the mandatory "schema" field`, `Add "schema": "<name>/${kind}@${major}", e.g. "swe-verify/${kind}@${major}".`)
  }
  const m = SCHEMA_RE.exec(schema)
  if (!m) return fail(`unrecognised schema identifier "${schema}"`, `Expected something of the form "<name>/${kind}@${major}".`)
  if (m[1] !== kind) return fail(`expected a ${kind} but got a ${m[1]}`, `Pass the ${kind} artefact, not the ${m[1]}.`)
  if (Number(m[2]) !== major) {
    return fail(
      `unsupported schema major: "${schema}" (this CLI understands major ${major})`,
      'Upgrade swe-verify to a version that understands this schema, or regenerate the artefact with this CLI.',
    )
  }
  return null
}

function ajvFindings(kind: string, validate: ValidateFunction): Finding[] {
  return (validate.errors ?? []).map((e) => ({
    code: 'SV002' as const,
    severity: 'error' as const,
    message: `${kind}${e.instancePath || ''} ${e.message ?? 'is invalid'}`,
    remedy: `Fix the ${kind} so it matches the ${kind}@1 schema, then re-run.`,
  }))
}

/**
 * Report fields the schema does not know about. They are ignored, not
 * rejected — an old CLI must be able to read a story from a newer one — but
 * they are surfaced once so a version skew is visible rather than silent.
 */
function unknownTopLevelFields(value: object, schema: { properties: Record<string, unknown> }): string[] {
  const known = new Set(Object.keys(schema.properties))
  return Object.keys(value).filter((k) => !known.has(k))
}

export function validatePlan(input: unknown): ValidationResult<Plan> {
  const bad = checkSchemaField(input, 'plan', 1)
  if (bad) return bad
  if (!validators.plan(input)) return { ok: false, findings: ajvFindings('plan', validators.plan) }

  const plan = input as Plan

  // Semantic rules the JSON Schema cannot express. `seq` is the join key
  // between plan, story events and artefacts (contracts §2), so a duplicate
  // silently mis-attributes evidence.
  const seqs = new Set<number>()
  for (const step of plan.steps) {
    if (seqs.has(step.seq)) {
      return fail(`plan has two steps with seq ${step.seq}`, 'Step seq values are the join key; make them unique and append-only.')
    }
    seqs.add(step.seq)
  }
  for (const assertion of plan.assertions) {
    // 0 anchors to the run rather than to a step. A process fixture drives
    // itself and produces no steps, so it has nothing else to point at — and
    // requiring a step there would mean inventing one that does nothing, just
    // to give an assertion somewhere to hang.
    if (assertion.afterStep === 0) continue
    if (!seqs.has(assertion.afterStep)) {
      return fail(
        `assertion "${assertion.id}" has afterStep ${assertion.afterStep}, which is not a step in this plan`,
        'Point afterStep at an existing step seq, or use 0 to assert on the run as a whole.',
      )
    }
  }

  return {
    ok: true,
    value: plan,
    warnings: unknownTopLevelFields(plan, planSchema as never).map(
      (k) => `plan contains unknown field "${k}"; ignoring (written by a newer swe-verify?)`,
    ),
  }
}

export function validateStory(input: unknown): ValidationResult<Story> {
  const bad = checkSchemaField(input, 'story', 1)
  if (bad) return bad
  if (!validators.story(input)) return { ok: false, findings: ajvFindings('story', validators.story) }
  const story = input as Story
  return {
    ok: true,
    value: story,
    warnings: unknownTopLevelFields(story, storySchema as never).map(
      (k) => `story contains unknown field "${k}"; ignoring (written by a newer swe-verify?)`,
    ),
  }
}

export function validateConfig(input: unknown): ValidationResult<Config> {
  const bad = checkSchemaField(input, 'config', 1)
  if (bad) return bad
  if (!validators.config(input)) return { ok: false, findings: ajvFindings('config', validators.config) }
  const config = input as Config
  return {
    ok: true,
    value: config,
    warnings: unknownTopLevelFields(config, configSchema as never).map(
      (k) => `config contains unknown field "${k}"; ignoring`,
    ),
  }
}

/** The free tier, spelled out: local runner, filesystem store, no telemetry. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  schema: 'swe-verify/config@1',
  domain: 'fullstack',
  vcs: 'auto',
  runner: 'local',
  artifactStore: 'fs',
  telemetry: 'off',
  scope: {
    // Everything by default: an include list that misses where a repo keeps
    // its code would silently gate nothing, which is worse than noisy.
    include: ['**'],
    exclude: ['**/*.md', '**/*.test.*', '**/*.spec.*', '**/migrations/**', '**/dist/**', '**/node_modules/**'],
    languages: ['ts', 'py', 'go', 'java'],
  },
  coverage: { policy: 'all-executable', defensive: 'warn', waiverCapPct: 10 },
  budgets: { runMs: 600_000, breakpointMs: 30_000, artifactBytes: 524_288_000, probeLines: 500, launchMs: 300_000 },
  bypass: { allowed: true, requiresReason: true, label: DEFAULT_BRAND.bypassLabel },
  // "the gate requires at least one agent-readable artefact per step" — the
  // rule the design calls the one that keeps recorders honest. Off by
  // default, it never fires, and a recorder can satisfy the gate with a video
  // the agent cannot watch.
  artifacts: { requireAgentReadable: true },
  redact: {
    keys: ['password', 'token', 'secret', 'authorization', 'cookie', 'ssn', 'api_key', 'apikey', 'private_key'],
    patterns: ['(?i)bearer\\s+[a-z0-9._-]+'],
    onUnknownBinary: 'drop',
  },
}

export function resolveConfig(input: Config): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...input,
    scope: { ...DEFAULT_CONFIG.scope, ...input.scope },
    coverage: { ...DEFAULT_CONFIG.coverage, ...input.coverage },
    budgets: { ...DEFAULT_CONFIG.budgets, ...input.budgets },
    bypass: { ...DEFAULT_CONFIG.bypass, ...input.bypass },
    artifacts: { ...DEFAULT_CONFIG.artifacts, ...input.artifacts },
    redact: { ...DEFAULT_CONFIG.redact, ...input.redact },
  }
}
