import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Brand, resolveBrand, schemaId,
  canonicalJson,
  resolveConfig,
  sha256,
  validateConfig,
  validatePlan,
  validateStory,
  type Plan,
  type PlanRef,
  type ResolvedConfig,
  type Story,
} from '@witness/core'
import { UsageError } from './errors.js'

/**
 * The free tier's entire persistence layer: a directory. A gate that needs a
 * database cannot run on a laptop with no network (TDD §9.1).
 *
 *   .witness/
 *     config.json          committed
 *     plans/*.plan.json    committed
 *     runs/<run_id>/       gitignored
 */
/**
 * Where per-repository state lives. Derived from the brand, so renaming the
 * tool renames the directory with it rather than leaving a `.witness`
 * behind that nothing calls itself any more.
 */
/**
 * Where per-repository state lives, for the brand in force.
 *
 * Threaded rather than fixed at import: the CLI is embeddable, and the test
 * suite drives it in-process, so `process.env` at module load is the wrong
 * source — it would pin one brand for the lifetime of the process and ignore
 * what an individual invocation asked for.
 */
export function dirFor(brand: Brand = resolveBrand(process.env)): string {
  return brand.dir
}

/** The default state directory, for messages that need to name one. */
export const DIR = dirFor()

export const paths = {
  root: (cwd: string, brand?: Brand) => join(cwd, dirFor(brand)),
  config: (cwd: string, brand?: Brand) => join(cwd, dirFor(brand), 'config.json'),
  plans: (cwd: string, brand?: Brand) => join(cwd, dirFor(brand), 'plans'),
  runs: (cwd: string, brand?: Brand) => join(cwd, dirFor(brand), 'runs'),
}

export function runDir(cwd: string, runId: string, brand?: Brand): string {
  return join(paths.runs(cwd, brand), runId)
}

function readJson(file: string, label: string): unknown {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new UsageError(`cannot read ${label} at ${file}: ${(error as Error).message}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new UsageError(`${label} at ${file} is not valid JSON: ${(error as Error).message}`)
  }
}

/** Whether the config came from a file, so `doctor` can say which. */
export function configSource(cwd: string, brand?: Brand): string | null {
  const file = paths.config(cwd, brand)
  return existsSync(file) ? file : null
}

export function loadConfig(cwd: string, brand?: Brand): ResolvedConfig {
  const file = paths.config(cwd, brand)
  if (!existsSync(file)) return resolveConfig({ schema: schemaId(brand ?? resolveBrand(process.env), 'config') })
  const parsed = readJson(file, 'config.json')
  const result = validateConfig(parsed)
  if (!result.ok) {
    throw new UsageError(
      `invalid config.json: ${result.findings.map((f) => f.message).join('; ')}`,
      'Fix .witness/config.json, or delete it to fall back to defaults.',
    )
  }
  return resolveConfig(result.value)
}

/**
 * The plan hash the story binds to. Hashing the *canonical* form rather than
 * the file bytes means reformatting a plan does not stale every story that
 * ran it, while any semantic edit still does.
 */
export function planSha(plan: unknown): string {
  return sha256(canonicalJson(plan))
}

export function loadPlans(cwd: string, brand?: Brand): PlanRef[] {
  const dir = paths.plans(cwd, brand)
  if (!existsSync(dir)) return []
  const refs: PlanRef[] = []
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.plan.json')) continue
    const file = join(dir, entry)
    const parsed = readJson(file, entry)
    const result = validatePlan(parsed)
    if (!result.ok) {
      throw new UsageError(
        `invalid plan ${entry}: ${result.findings.map((f) => f.message).join('; ')}`,
        'Fix the plan, or regenerate it with `witness plan`.',
      )
    }
    const plan = result.value
    refs.push({
      id: plan.id,
      sha256: planSha(plan),
      scope: plan.scope,
      waivers: plan.coverage?.waivers ?? [],
      assertionCount: plan.assertions.length,
    })
  }
  return refs
}

/**
 * Every committed plan, in full. `loadPlans` returns only what the gate needs
 * (scope, waivers, a hash); the generator needs the intent and the fixture
 * too, and both must read the same directory by the same rules.
 */
export function loadFullPlans(cwd: string, brand?: Brand): Plan[] {
  const dir = paths.plans(cwd, brand)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.plan.json'))
    .sort()
    .map((entry) => loadPlan(join(dir, entry)))
}

export function loadPlan(file: string): Plan {
  const parsed = readJson(file, 'plan')
  const result = validatePlan(parsed)
  if (!result.ok) {
    throw new UsageError(`invalid plan ${file}: ${result.findings.map((f) => f.message).join('; ')}`)
  }
  return result.value
}

export function readStory(file: string): Story {
  const parsed = readJson(file, 'story.json')
  const result = validateStory(parsed)
  if (!result.ok) {
    throw new UsageError(`invalid story ${file}: ${result.findings.map((f) => f.message).join('; ')}`)
  }
  return result.value
}

export function writeStory(cwd: string, runId: string, story: Story, brand?: Brand): string {
  const dir = runDir(cwd, runId, brand)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'story.json')
  writeFileSync(file, `${JSON.stringify(story, null, 2)}\n`)
  return file
}

const GITIGNORE = `# witness run artefacts are per-run and large; the plan is what gets committed.
runs/
`

export function scaffold(cwd: string, brand?: Brand): { created: string[] } {
  const created: string[] = []
  mkdirSync(paths.plans(cwd, brand), { recursive: true })
  mkdirSync(paths.runs(cwd, brand), { recursive: true })

  const config = paths.config(cwd, brand)
  if (!existsSync(config)) {
    // Written as the minimal explicit form rather than every default, so the
    // file stays readable and defaults can improve without a migration.
    writeFileSync(config, `${JSON.stringify({
      schema: schemaId(brand ?? resolveBrand(process.env), 'config'),
      domain: 'fullstack',
      vcs: 'auto',
      runner: 'local',
      artifactStore: 'fs',
      telemetry: 'off',
      coverage: { policy: 'all-executable', defensive: 'warn', waiverCapPct: 10 },
    }, null, 2)}\n`)
    created.push(config)
  }

  const ignore = join(paths.root(cwd, brand), '.gitignore')
  if (!existsSync(ignore)) {
    writeFileSync(ignore, GITIGNORE)
    created.push(ignore)
  }
  return { created }
}
