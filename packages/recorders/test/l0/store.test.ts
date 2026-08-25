import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactStore } from '../../src/store.js'
import { compileRedactionPolicy, DEFAULT_CONFIG } from '@macquery-labs/core'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'witness-store-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const store = (over = {}) => new ArtifactStore({
  runDir: dir,
  policy: compileRedactionPolicy(DEFAULT_CONFIG.redact),
  budgetBytes: 1_000_000,
  ...over,
})

describe('ArtifactStore', () => {
  it('writes an artefact and describes it for the story', () => {
    const artifact = store().writeJson({ kind: 'snapshot', name: 'a11y/0002-after.json', stepSeq: 2, readableBy: ['agent'] }, { role: 'button' })!
    expect(artifact.path).toBe('artifacts/a11y/0002-after.json')
    expect(artifact.sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(artifact.step_seq).toBe(2)
    expect(JSON.parse(readFileSync(join(dir, artifact.path), 'utf8'))).toEqual({ role: 'button' })
  })

  it('records paths relative to the run directory, never absolute', () => {
    const artifact = store().writeJson({ kind: 'transcript', name: 'api/1.json', readableBy: ['agent'] }, {})!
    expect(artifact.path.startsWith('/')).toBe(false)
    expect(artifact.path).not.toContain(dir)
  })

  it('redacts before the bytes reach disk (NFR-5)', () => {
    const artifact = store().writeJson({ kind: 'transcript', name: 'api/1.json', readableBy: ['agent'] }, { password: 'hunter2', ok: 1 })!
    const onDisk = readFileSync(join(dir, artifact.path), 'utf8')
    expect(onDisk).not.toContain('hunter2')
    expect(onDisk).toContain('[redacted]')
  })

  it('redacts binary-adjacent secrets in text artefacts too', () => {
    const artifact = store().writeText({ kind: 'log', name: 'app.log', readableBy: ['human'] }, 'GET / with Bearer abc123\n')!
    expect(readFileSync(join(dir, artifact.path), 'utf8')).not.toContain('abc123')
  })

  it('declares who can read each artefact (FR-15)', () => {
    expect(store().writeJson({ kind: 'snapshot', name: 'a.json', readableBy: ['agent'] }, {})!.readableBy).toEqual(['agent'])
    expect(store().writeBinary({ kind: 'video', name: 'v.webm', readableBy: ['human'] }, Buffer.from([1, 2]))!.readableBy).toEqual(['human'])
  })

  it('drops human-readable artefacts first when the budget is exhausted', () => {
    const s = store({ budgetBytes: 200 })
    const video = s.writeBinary({ kind: 'video', name: 'v.webm', readableBy: ['human'] }, Buffer.alloc(500))
    const snapshot = s.writeJson({ kind: 'snapshot', name: 'a.json', readableBy: ['agent'] }, { a: 1 })
    expect(video).toBeNull()
    expect(snapshot).not.toBeNull()
  })

  it('keeps agent-readable artefacts even over budget, because the agent is the primary reader', () => {
    const s = store({ budgetBytes: 10 })
    expect(s.writeJson({ kind: 'snapshot', name: 'a.json', readableBy: ['agent'] }, { a: 'x'.repeat(100) })).not.toBeNull()
  })

  it('reports what it dropped rather than dropping silently', () => {
    const s = store({ budgetBytes: 100 })
    s.writeBinary({ kind: 'video', name: 'v.webm', readableBy: ['human'] }, Buffer.alloc(500))
    expect(s.dropped).toHaveLength(1)
    expect(s.dropped[0]).toMatch(/v\.webm/)
  })

  it('tracks total bytes written', () => {
    const s = store()
    s.writeText({ kind: 'log', name: 'a.log', readableBy: ['human'] }, 'hello')
    expect(s.bytesWritten).toBe(5)
  })
})
