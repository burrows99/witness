import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  compileRedactionPolicy,
  diffHash,
  gatedDiff,
  planProbes,
  redactStory,
  ulid,
  type Driver,
  type NormalisedDiff,
  type Plan,
  type ProbeTarget,
  type ResolvedConfig,
  type RunContext,
  type StepResult,
  type Story,
  type StoryArtifact,
  type StoryAssertion,
  type StoryDiagnostic,
  type Recorder,
  validateRecording,
  type UnsequencedEvent,
  type StoryView,
} from '@swe-verify/core'
import { DapSession, type InstalledProbe } from '@swe-verify/probe-dap'
import { ApiDriver, assertionKinds, newTraceId } from '@swe-verify/driver-api'
import { ArtifactStore, createRecorders, slideDocument, type Slide, type TerminalSource } from '@swe-verify/recorders'
import { HarnessError, UsageError } from '../errors.js'
import { runDir as runDirFor } from '../workspace.js'
import { startFixture, waitForReady } from './fixture.js'
import { assembleStory, type ProbeOutcome } from './story.js'

/**
 * The runner: instrument the diff, drive the plan, seal one story.
 *
 * The order matters and is not negotiable. Probes go in *before* the
 * application does any work, because a probe installed after the request it
 * was meant to observe is indistinguishable from a line that never ran.
 */

export interface RunOptions {
  plan: Plan
  planSha256: string
  config: ResolvedConfig
  diff: NormalisedDiff
  cwd: string
  env: Record<string, string | undefined>
  vcs: { provider: string; change_id?: string; actor?: string }
  cliVersion: string
  now?: Date
  /**
   * Film the run. Recording is a property of the browser context, so it is
   * decided before the first page opens — there is no starting halfway.
   */
  record?: {
    label: string
    slide: Slide
    /** Commands to film alongside the browser, for work with no screen. */
    terminal?: TerminalSource
  } | undefined
}

export interface RunOutcome {
  story: Story
  runId: string
  storyPath: string
  logPath: string
  /** The finished mp4, when the run was filmed. */
  videoPath?: string
}

export async function runPlan(options: RunOptions): Promise<RunOutcome> {
  const startedAt = options.now ?? new Date()
  const runId = ulid(startedAt)
  const dir = runDirFor(options.cwd, runId)
  mkdirSync(dir, { recursive: true })
  const logPath = join(dir, 'logs', 'harness.log')
  mkdirSync(join(dir, 'logs'), { recursive: true })

  const log = (line: string) => {
    // The harness must be debuggable when *it* is the thing that broke (M5).
    try { appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`) } catch { /* logging must not fail a run */ }
  }

  const scoped = gatedDiff(options.diff, options.config)
  const targets = planProbes(scoped, options.config, {
    onTruncate: (dropped) => log(`instrumentation truncated: ${dropped} line(s) over the ${options.config.budgets.probeLines}-probe budget`),
  })
  log(`run ${runId}: ${scoped.changedLines} changed line(s), ${targets.length} probe target(s)`)

  const ctx: RunContext = {
    runId,
    repoRoot: options.cwd,
    runDir: dir,
    traceId: newTraceId(),
    env: options.env,
    log,
    monoNs: () => Number(process.hrtime.bigint()),
  }

  const store = new ArtifactStore({
    runDir: dir,
    policy: compileRedactionPolicy(options.config.redact),
    budgetBytes: options.config.budgets.artifactBytes,
  })

  const events: UnsequencedEvent[] = []
  const artifacts: StoryArtifact[] = []
  const diagnostics: StoryDiagnostic[] = []
  const stepResults = new Map<number, StepResult>()

  const fixture = await startFixture({
    fixture: options.plan.fixture,
    cwd: options.cwd,
    repoRoot: options.cwd,
    env: options.env,
    log,
  })
  if (fixture.baseUrl) ctx.baseUrl = fixture.baseUrl

  let session: DapSession | null = null
  let installed: InstalledProbe[] = []
  const driversToClose: Driver[] = []
  const recorders: Recorder[] = []

  try {
    // Attach whenever the fixture is debuggable, even with nothing to
    // instrument: an adapter started with `--wait-for-client` blocks until a
    // client connects, so skipping the attach would hang a run whose diff
    // simply had no gateable lines.
    if (fixture.debug && fixture.adapter) {
      session = await attachProbes({
        fixture,
        targets,
        cwd: options.cwd,
        env: options.env,
        launchMs: options.config.budgets.launchMs,
        log,
      })
      installed = [...session.probes]
      const unverified = installed.filter((p) => !p.verified)
      log(`probes: ${installed.length} installed, ${installed.length - unverified.length} verified`)
      for (const probe of unverified) {
        // Recorded here as well as in coverage: when a run goes wrong, the
        // log is where the answer has to be.
        log(`probe ${probe.id} on ${probe.file}:${probe.line} was accepted but NOT verified${probe.message ? ` (${probe.message})` : ''}`)
      }
    } else if (targets.length > 0) {
      diagnostics.push({
        code: 'SVH001',
        severity: 'warn',
        message: `no debuggable fixture: ${targets.length} changed line(s) could not be instrumented`,
      })
      log('no debuggable fixture declared; the run will produce no coverage')
    }

    await waitForReady(
      options.plan.fixture?.ready?.map((check) => ({
        ...check,
        ...(check.http ? { http: fixture.substitute(check.http) } : {}),
      })),
      log,
    )

    const drivers = await loadDrivers(store, options.plan, log, options.record ? join(dir, 'raw-video') : undefined)
    driversToClose.push(...drivers.values())

    // Recording is a recorder's job, not a driver's, and *which* recorders
    // exist is the registry's business rather than the runner's. The runner
    // offers what this run has — a browser context, a list of commands — and
    // takes back whatever can record from it. Adding a recorder does not
    // touch this file.
    if (options.record) {
      const web = drivers.get('web') as unknown as BrowserSourceCapable | undefined
      recorders.push(...createRecorders({
        runDir: dir,
        store,
        ...(web?.recordedVideo
          ? {
              browser: {
                videoDir: () => join(dir, 'raw-video'),
                recordedVideo: () => web.recordedVideo(),
                finish: async () => { await (web as unknown as Driver).close?.() },
              },
            }
          : {}),
        ...(options.record.terminal ? { terminal: options.record.terminal } : {}),
        card: options.record.slide,
        renderCard: renderSlidePng,
        width: 1280,
        height: 720,
      }))
      if (recorders.length === 0) {
        log('recording: nothing in this run can be recorded — no browser context and no commands to film')
      }
    }
    for (const recorder of recorders) await recorder.start(ctx)
    for (const step of [...options.plan.steps].sort((a, b) => a.seq - b.seq)) {
      const driver = drivers.get(step.driver)
      if (!driver) {
        throw new UsageError(
          `no driver "${step.driver}" for step ${step.seq}`,
          `Available drivers in this build: ${[...drivers.keys()].join(', ')}.`,
        )
      }
      log(`step ${step.seq}: ${step.driver} ${step.action} ${JSON.stringify(step.args ?? {})}`)
      for (const recorder of recorders) await recorder.mark({ seq: step.seq, driver: step.driver, action: step.action })
      const result = await driver.execute(step, ctx)
      stepResults.set(step.seq, result)
      events.push({
        tier: driver.name === 'web' ? 'browser' : 'harness',
        trace_id: ctx.traceId,
        step_seq: step.seq,
        wall: new Date().toISOString(),
        mono_ns: ctx.monoNs(),
        type: 'step',
        driver: step.driver,
        action: step.action,
        args: step.args ?? {},
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      })
      events.push(...result.events)
      artifacts.push(...result.artifacts)
      if (result.status === 'error') {
        diagnostics.push({ code: 'SVH030', severity: 'warn', message: `step ${step.seq} failed: ${result.error ?? 'unknown error'}` })
      }

      // Drained per step, not at the end: a logpoint that fired while step 2
      // was running belongs to step 2. That attribution is what lets a UI
      // action be linked to the server frame it caused (M2) — the alternative
      // is correlating by timestamp, which is the thing this replaces.
      if (session) {
        await new Promise((r) => setTimeout(r, 50))
        pushHits(events, session.drain(), installed, ctx.traceId, step.seq)
      }
    }

    // A job or script fixture has to finish before its coverage is complete;
    // a server never exits, so waiting is opt-in rather than the default.
    if (session && options.plan.fixture?.awaitExit) {
      const exited = await session.waitForExit(options.config.budgets.runMs)
      if (!exited) {
        throw new HarnessError(
          `fixture did not exit within the ${Math.round(options.config.budgets.runMs / 1000)}s run budget`,
          'Raise budgets.runMs, or drop fixture.awaitExit if the process is a long-running server.',
        )
      }
    }

    // Probe output can lag the request that caused it; draining before the
    // last hit arrives would report a line that ran as unexercised.
    if (session) await new Promise((r) => setTimeout(r, 250))

    // Whatever fired outside a step — during startup, or after the last one.
    pushHits(events, session?.drain() ?? [], installed, ctx.traceId, undefined)

    for (const dropped of store.dropped) {
      diagnostics.push({ code: 'SVH040', severity: 'warn', message: `artefact dropped: ${dropped}` })
    }
    for (const diagnostic of session?.diagnostics ?? []) {
      diagnostics.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.file ? { file: diagnostic.file } : {}),
        ...(diagnostic.line !== undefined ? { line: diagnostic.line } : {}),
      })
    }

    // Recorders are stopped before the story is assembled: a recording that
    // arrives after sealing is not in the artefact list, which is the same as
    // not existing as far as every consumer is concerned.
    let videoPath: string | undefined
    for (const recorder of recorders) {
      const produced = await recorder.stop()
      // The same check the conformance suite applies, applied to the real
      // output: a recorder that emits a kind it never declared, or an
      // artefact nobody is declared to read, has broken the contract every
      // consumer downstream relies on. Better a harness failure than a story
      // whose artefact list cannot be trusted.
      //
      // Agent-readability is deliberately NOT checked here. It is a property
      // of a *step*, not of a recorder: a video is one continuous artefact
      // spanning the run, while the a11y snapshot an agent reads is written
      // per step by the driver. SV030 owns that question in the gate, where
      // every artefact is in view — asking it of one recorder in isolation
      // would fail a perfectly well-behaved video recorder.
      const violations = validateRecording(recorder, produced)
      if (violations.length > 0) {
        throw new HarnessError(
          `recorder "${recorder.name}" broke the recorder contract`,
          violations.join('; '),
        )
      }
      artifacts.push(...produced)
      const video = produced.find((a: StoryArtifact) => a.kind === 'video')
      if (video) {
        videoPath = join(dir, video.path)
        log(`recording: ${video.path} (${video.bytes} bytes, readable by ${video.readableBy.join(', ')})`)
      }
    }

    const assertions = await evaluateAssertions(options.plan, drivers, stepResults, events, artifacts)
    for (const assertion of assertions) {
      events.push({
        tier: 'harness',
        trace_id: ctx.traceId,
        wall: new Date().toISOString(),
        mono_ns: ctx.monoNs(),
        type: 'assertion',
        assertion_id: assertion.id,
        status: assertion.status === 'pass' ? 'pass' : 'fail',
      })
    }

    const probes: ProbeOutcome[] = targets.map((target) => {
      const probe = installed.find((p) => p.id === target.id)
      return {
        target,
        verified: probe?.verified ?? false,
        ...(probe?.adapterLine !== undefined ? { adapterLine: probe.adapterLine } : {}),
        hits: session?.hitsFor(target.id) ?? 0,
      }
    })

    const story = assembleStory({
      runId,
      planId: options.plan.id,
      planSha256: options.planSha256,
      diff: scoped,
      diffHash: diffHash(scoped),
      config: options.config,
      vcs: options.vcs,
      cli: options.cliVersion,
      startedAt,
      sealedAt: new Date(),
      events,
      probes,
      assertions,
      artifacts,
      diagnostics,
    })

    // Redaction runs before the story reaches disk, not before it is
    // uploaded: a leaked token in a CI artifact has already leaked (NFR-5).
    const redacted = redactStory(story, compileRedactionPolicy(options.config.redact))
    const storyPath = writeSealedStory(dir, redacted)
    log(`sealed story ${storyPath}`)

    return { story: redacted, runId, storyPath, logPath, ...(videoPath ? { videoPath } : {}) }
  } catch (error) {
    if (error instanceof UsageError || error instanceof HarnessError) throw error
    throw new HarnessError(`run failed: ${(error as Error).message}`)
  } finally {
    for (const driver of driversToClose) {
      try { await driver.close?.() } catch { /* already closed when recording finished */ }
    }
    try { await session?.uninstall() } catch { /* teardown is best-effort */ }
    await fixture.stop()
    // The application's own output is evidence too: when a probe did not fire,
    // the first question is always "did the app even do the thing?".
    const stdout = fixture.stdout()
    if (stdout.trim()) log(`fixture stdout:\n${stdout.trim()}`)
    const stderr = fixture.stderr()
    if (stderr.trim()) log(`fixture stderr:\n${stderr.trim()}`)
  }
}

/**
 * Drivers are loaded on demand. `web` pulls in a browser, which must not be a
 * requirement for a backend-only change (NFR-7): a plan that never mentions
 * the web driver never loads Playwright.
 */
async function loadDrivers(
  store: ArtifactStore,
  plan: Plan,
  log: (line: string) => void,
  videoDir?: string,
): Promise<Map<string, Driver>> {
  const drivers = new Map<string, Driver>([['api', new ApiDriver({ store })]])
  if (!plan.steps.some((step) => step.driver === 'web')) return drivers

  const web = await import('@swe-verify/driver-web').catch(() => null)
  if (!web?.isPlaywrightAvailable()) {
    throw new UsageError(
      'this plan uses the web driver, but Playwright is not installed',
      'Install playwright and its browsers (npx playwright install chromium), or rewrite the plan to drive the API.',
    )
  }
  log(`drivers: web (playwright)${videoDir ? ', recording' : ''}`)
  drivers.set('web', new web.WebDriver({ store, ...(videoDir ? { videoDir } : {}) }))
  return drivers
}

function pushHits(
  events: UnsequencedEvent[],
  hits: ReadonlyArray<{ probeId: string; vars: Record<string, unknown>; monoNs: number; wall: string }>,
  installed: readonly InstalledProbe[],
  traceId: string,
  stepSeq: number | undefined,
): void {
  for (const hit of hits) {
    const probe = installed.find((p) => p.id === hit.probeId)
    events.push({
      tier: 'server',
      trace_id: traceId,
      ...(stepSeq !== undefined ? { step_seq: stepSeq } : {}),
      wall: hit.wall,
      mono_ns: hit.monoNs,
      type: 'logpoint',
      probe_id: hit.probeId,
      file: probe?.file ?? '',
      line: probe?.line ?? 0,
      vars: hit.vars,
      hit: 1,
    })
  }
}

/** What the runner needs from whichever driver holds the browser. */
interface BrowserSourceCapable {
  recordedVideo(): string | null
}

/** Renders a title card to a still, using the browser the driver already has. */
async function renderSlidePng(card: Slide, png: string, width: number, height: number): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const html = png.replace(/\.png$/, '.html')
  writeFileSync(html, slideDocument(card, width, height))
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`file://${html}`)
    await page.screenshot({ path: png })
  } finally {
    await browser.close()
  }
}

async function attachProbes(params: {
  fixture: Awaited<ReturnType<typeof startFixture>>
  targets: readonly ProbeTarget[]
  cwd: string
  env: Record<string, string | undefined>
  launchMs: number
  log: (line: string) => void
}): Promise<DapSession> {
  const { fixture, targets, cwd, log } = params
  const debug = fixture.debug!
  const adapter = fixture.adapter!

  const session = await DapSession.connectTcp(debug.host, debug.port, {
    repoRoot: cwd,
    log,
    connectTimeoutMs: 30_000,
    launchTimeoutMs: params.launchMs,
    onOutput: (text) => log(`app: ${text.trimEnd()}`),
  })

  await session.initialize()
  const args = adapter.configureArgs({
    program: fixture.program,
    cwd: fixture.cwd,
    repoRoot: cwd,
    port: debug.port,
    pathMapping: null,
    env: params.env,
    ...(fixture.mode ? { mode: fixture.mode } : {}),
    ...(fixture.args ? { args: fixture.args } : {}),
  })
  if (adapter.configure === 'attach') await session.attach(args)
  else await session.launch(args)

  await session.install(targets)
  await session.configurationDone()
  return session
}

async function evaluateAssertions(
  plan: Plan,
  drivers: Map<string, Driver>,
  stepResults: Map<number, StepResult>,
  events: UnsequencedEvent[],
  artifacts: StoryArtifact[],
): Promise<StoryAssertion[]> {
  const kinds = new Map(assertionKinds().map((kind) => [kind.kind, kind]))

  // `ui-text` reads the live page, so it only exists when a browser does.
  const web = drivers.get('web')
  if (web) {
    const { uiText } = await import('@swe-verify/driver-web')
    const kind = uiText(web as never)
    kinds.set(kind.kind, kind)
  }
  const view: StoryView = {
    stepResult: (seq) => stepResults.get(seq),
    events: () => events,
    artifacts: () => artifacts,
  }

  const results: StoryAssertion[] = []
  for (const assertion of plan.assertions) {
    const kind = kinds.get(assertion.kind)
    if (!kind) {
      // An assertion whose kind this build cannot evaluate is skipped and
      // said so, never quietly passed.
      results.push({
        id: assertion.id,
        status: 'skipped',
        diff: `no assertion kind "${assertion.kind}" in this build (available: ${[...kinds.keys()].join(', ')})`,
      })
      continue
    }
    const outcome = await kind.evaluate(assertion.expect, view, assertion.afterStep)
    results.push({
      id: assertion.id,
      status: outcome.status,
      ...(outcome.expected !== undefined ? { expected: outcome.expected } : {}),
      ...(outcome.actual !== undefined ? { actual: outcome.actual } : {}),
      ...(outcome.diff ? { diff: outcome.diff } : {}),
    })
  }
  return results
}

function writeSealedStory(dir: string, story: Story): string {
  const path = join(dir, 'story.json')
  writeFileSync(path, `${JSON.stringify(story, null, 2)}\n`)
  return path
}
