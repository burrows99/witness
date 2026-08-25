/**
 * The product's name, in one place.
 *
 * It was spread across 179 literals — the state directory, the environment
 * variables, the bypass label, the schema ids, the help text — so renaming
 * meant a careful sweep with no way to tell which occurrences were cosmetic
 * and which were wire format that other people's committed files depend on.
 *
 * That distinction is the whole design here. Everything a person *sees* is
 * derived from one word and can change whenever they like. What is *written
 * into their files* is treated differently: documents are written under the
 * current name and read regardless of it, so a rename never orphans a plan or
 * a story someone already committed.
 */

export interface Brand {
  /** The product name, as written in prose. */
  name: string
  /** The command a person types. */
  cli: string
  /** Where per-repository state lives. */
  dir: string
  /** Prefix for environment variables, upper snake case. */
  envPrefix: string
  /** Namespace written into `schema` fields of new documents. */
  schemaNs: string
  /** The label that authorises a bypass on a change. */
  bypassLabel: string
}

/** Kinds of document this build understands, and the major it speaks. */
export const SCHEMA_KINDS = ['plan', 'story', 'config'] as const
export type SchemaKind = (typeof SCHEMA_KINDS)[number]
const SCHEMA_MAJOR = 1

/** A name has to survive being a directory, a label and a shell variable. */
function usable(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(name.trim())
}

export function brandFrom(name: string): Brand {
  const trimmed = name.trim()
  if (!usable(trimmed)) {
    throw new TypeError(
      `"${name}" cannot name this tool: it becomes a directory, a label and an environment prefix, so it must be letters, digits, dot, dash, underscore or space.`,
    )
  }
  return {
    name: trimmed,
    cli: trimmed,
    dir: `.${trimmed}`,
    // `SWE_VERIFY_JS_DEBUG`, not `SWE-VERIFY_JS_DEBUG`, which no shell exports.
    envPrefix: trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
    schemaNs: trimmed,
    bypassLabel: `${trimmed}:bypass`,
  }
}

export const DEFAULT_BRAND: Brand = brandFrom('swe-verify')

/**
 * The brand for this process.
 *
 * `<PREFIX>_BRAND` under the default prefix bootstraps a rename; the same
 * variable under the *new* prefix keeps working afterwards, because an
 * operator who has renamed the tool to `acme` will reach for `ACME_BRAND`,
 * and only honouring the old name would leave the rebrand permanently leaky.
 * A name that cannot be used is ignored rather than fatal: a bad variable
 * should not stop every command in a repository from running.
 */
export function resolveBrand(env: Record<string, string | undefined>): Brand {
  const candidates = Object.entries(env)
    .filter(([key, value]) => key.endsWith('_BRAND') && typeof value === 'string' && value.trim().length > 0)
    .map(([, value]) => value!)

  for (const candidate of candidates) {
    try {
      return brandFrom(candidate)
    } catch {
      continue
    }
  }
  return DEFAULT_BRAND
}

/**
 * What a `schema` field says, ignoring who wrote it.
 *
 * `swe-verify/plan@1` and `acme/plan@1` are the same document. Checking the
 * brand on read would mean a rename silently orphaned every plan and story a
 * team had already committed, which is the one thing a rename must never do.
 */
export function schemaKind(schema: string): { kind: SchemaKind; major: number } | null {
  const match = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\/([a-z]+)@(\d+)$/.exec(schema)
  if (!match) return null
  const kind = match[1] as SchemaKind
  const major = Number(match[2])
  if (!(SCHEMA_KINDS as readonly string[]).includes(kind)) return null
  if (major !== SCHEMA_MAJOR) return null
  return { kind, major }
}

/** The `schema` value new documents are written with. */
export function schemaId(brand: Brand, kind: SchemaKind): string {
  return `${brand.schemaNs}/${kind}@${SCHEMA_MAJOR}`
}

/**
 * Look up an environment variable by its suffix, under the current brand and
 * under the default one.
 *
 * A rename has to work in both directions. Someone who has renamed the tool
 * to `acme` will export `ACME_JS_DEBUG`, while an existing machine, CI job or
 * shell profile still exports `SWE_VERIFY_JS_DEBUG` — and breaking those on a
 * rename would make renaming something nobody dares do. Both are honoured,
 * the current brand first.
 */
export function brandEnv(
  env: Record<string, string | undefined>,
  suffix: string,
  brand: Brand = resolveBrand(env),
): string | undefined {
  return env[`${brand.envPrefix}_${suffix}`] ?? env[`${DEFAULT_BRAND.envPrefix}_${suffix}`]
}

/** The name to *document*, so help text and remedies say the right thing. */
export function brandEnvName(suffix: string, brand: Brand = DEFAULT_BRAND): string {
  return `${brand.envPrefix}_${suffix}`
}
