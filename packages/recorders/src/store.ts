import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { redact, sha256, sha256Bytes, type RedactionPolicy, type Reader, type StoryArtifact } from '@macquery-labs/core'

/**
 * Where evidence is written, and the one place it is written.
 *
 * Two rules live here rather than in each recorder, because a rule enforced
 * in five places is a rule broken in one:
 *
 *  - Redaction runs *before the bytes reach disk* (NFR-5). A leaked token in
 *    a CI artifact has already leaked; redacting at upload time is too late.
 *  - When the artefact budget is exhausted, human-readable output is dropped
 *    first and agent-readable output is kept. The agent is the primary user
 *    and cannot watch a video (TDD §10.4).
 */

export interface ArtifactStoreOptions {
  runDir: string
  policy: RedactionPolicy
  budgetBytes: number
}

export interface ArtifactSpec {
  kind: string
  /** Path under `artifacts/`, e.g. `a11y/0002-after.json`. */
  name: string
  readableBy: Reader[]
  stepSeq?: number
}

export class ArtifactStore {
  bytesWritten = 0
  readonly dropped: string[] = []

  constructor(private readonly options: ArtifactStoreOptions) {}

  writeJson(spec: ArtifactSpec, value: unknown): StoryArtifact | null {
    return this.writeText(spec, `${JSON.stringify(redact(value, this.options.policy), null, 2)}\n`, { preRedacted: true })
  }

  writeText(spec: ArtifactSpec, text: string, options: { preRedacted?: boolean } = {}): StoryArtifact | null {
    const contents = options.preRedacted ? text : redact(text, this.options.policy)
    const bytes = Buffer.byteLength(contents)
    if (!this.admit(spec, bytes)) return null
    const relative = this.persist(spec.name, contents)
    return this.describe(spec, relative, sha256(contents), bytes)
  }

  writeBinary(spec: ArtifactSpec, data: Uint8Array): StoryArtifact | null {
    // Binary is opaque to key- and pattern-based redaction, so the policy's
    // `onUnknownBinary` decides whether it is written at all.
    if (this.options.policy.onUnknownBinary === 'drop' && !isKnownSafeBinary(spec.kind)) {
      this.dropped.push(`${spec.name} (binary, redaction policy onUnknownBinary=drop)`)
      return null
    }
    if (!this.admit(spec, data.byteLength)) return null
    const relative = this.persist(spec.name, data)
    return this.describe(spec, relative, sha256Bytes(data), data.byteLength)
  }

  /**
   * Take a file that already exists — a recording ffmpeg just wrote — and
   * declare it as an artefact. Binary produced by the harness itself carries
   * no captured application state, so it needs no redaction pass; what it
   * does need is a declared reader, or the gate cannot reason about it.
   */
  adopt(spec: ArtifactSpec, absolutePath: string): StoryArtifact | null {
    if (!existsSync(absolutePath)) return null
    const data = readFileSync(absolutePath)
    if (!this.admit(spec, data.byteLength)) return null
    const relative = this.persist(spec.name, data)
    return this.describe(spec, relative, sha256Bytes(data), data.byteLength)
  }

  private admit(spec: ArtifactSpec, bytes: number): boolean {
    const agentReadable = spec.readableBy.includes('agent')
    if (agentReadable) return true
    if (this.bytesWritten + bytes <= this.options.budgetBytes) return true
    this.dropped.push(`${spec.name} (${bytes} bytes, over the ${this.options.budgetBytes}-byte artefact budget)`)
    return false
  }

  private persist(name: string, contents: string | Uint8Array): string {
    const relative = join('artifacts', name)
    const absolute = join(this.options.runDir, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents)
    this.bytesWritten += typeof contents === 'string' ? Buffer.byteLength(contents) : contents.byteLength
    return relative
  }

  private describe(spec: ArtifactSpec, path: string, digest: string, bytes: number): StoryArtifact {
    return {
      kind: spec.kind,
      path,
      sha256: digest,
      bytes,
      readableBy: spec.readableBy,
      ...(spec.stepSeq !== undefined ? { step_seq: spec.stepSeq } : {}),
    }
  }
}

/** Media the harness produced itself, which cannot contain app secrets it did not capture. */
function isKnownSafeBinary(kind: string): boolean {
  return kind === 'screenshot' || kind === 'video' || kind === 'trace'
}
