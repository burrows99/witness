import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import type { Browser, BrowserContext, ConsoleMessage, Page } from 'playwright'
import { has, readNumber, readString, type Driver, type PlanArgs, type PlanStep, type RunContext, type StepResult, type StoryArtifact, type UnsequencedEvent } from '@macquery-labs/core'
import { newSpanId, traceparent } from '@macquery-labs/driver-api'
import type { ArtifactStore } from '@macquery-labs/recorders'
import { applyChrome, resetChrome, type ProbeReading } from './overlay.js'

/**
 * The `web` driver — Playwright.
 *
 * Two things make it more than a click harness:
 *
 *  - Every request the page makes is stamped with the run's `traceparent`,
 *    each with its own span. That is what lets a UI action be linked to the
 *    server frame it caused (M2) instead of guessed at by timestamp.
 *  - Every step leaves an accessibility snapshot behind, which is the
 *    artefact the *agent* can actually read. A screenshot is for the human;
 *    the primary user of this system cannot see it (FR-15).
 */

export interface WebDriverOptions {
  store?: ArtifactStore
  headless?: boolean
  viewport?: { width: number; height: number }
  /**
   * Where Playwright writes the raw `.webm`. Recording is a property of the
   * browser context, so it has to be decided before the first page opens —
   * there is no way to start filming halfway through a run.
   */
  videoDir?: string
  /**
   * Where Playwright writes the HAR. Same constraint as the video: recording
   * is a property of the context, decided before the first page opens.
   */
  harPath?: string
}

interface RequestRecord {
  method: string
  url: string
  spanId: string
  status?: number
  durationMs: number
  startedMono: number
}

export function isPlaywrightAvailable(): boolean {
  try {
    // Resolved rather than imported: the gate must run in CI with no browser
    // installed (NFR-7), so this package degrades to "unavailable" instead of
    // failing to load.
    createRequire(import.meta.url).resolve('playwright')
    return true
  } catch {
    return false
  }
}

export class WebDriver implements Driver {
  readonly name = 'web'
  readonly actions = [
    'goto', 'click', 'fill', 'press', 'select', 'waitFor', 'screenshot', 'evaluate',
    // Narration. These exist as plan actions rather than harness code so any
    // project gets captioned evidence from JSON, without writing a driver.
    'caption', 'probe', 'beat',
  ] as const

  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private consoleLines: string[] = []
  private requests: RequestRecord[] = []
  private pendingVideo: string | null = null

  constructor(private readonly options: WebDriverOptions = {}) {}

  async execute(step: PlanStep, ctx: RunContext): Promise<StepResult> {
    if (!(this.actions as readonly string[]).includes(step.action)) {
      return {
        status: 'error',
        error: `the web driver has no action "${step.action}" (supported: ${this.actions.join(', ')})`,
        events: [],
        artifacts: [],
      }
    }

    const page = await this.ensurePage(ctx)
    const args: PlanArgs = step.args ?? {}
    const timeout = readNumber(args, 'timeoutMs', 10_000)
    const startedMono = ctx.monoNs()
    const wall = new Date().toISOString()

    this.requests = []
    this.consoleLines = []

    let status: 'ok' | 'error' = 'ok'
    let error: string | undefined
    let data: Record<string, unknown> = {}

    try {
      data = await this.perform(page, step, args, timeout, ctx)
    } catch (cause) {
      status = 'error'
      // Playwright's messages are long and useful; the first lines carry the
      // selector and the timeout, which is what a developer needs.
      error = String((cause as Error).message).split('\n').slice(0, 3).join(' ').trim()
    }

    // Evidence is captured whether the step passed or failed. A failed step is
    // the interesting one, and a harness that only records success is theatre.
    const artifacts = await this.capture(page, step, ctx)

    const events: UnsequencedEvent[] = this.requests.map((request) => ({
      tier: 'browser',
      trace_id: ctx.traceId,
      span_id: request.spanId,
      step_seq: step.seq,
      wall,
      mono_ns: request.startedMono,
      type: 'span',
      name: `${request.method} ${safePath(request.url)}`,
      kind: 'client',
      attrs: {
        'http.request.method': request.method,
        'url.full': request.url,
        ...(request.status !== undefined ? { 'http.status_code': request.status } : {}),
      },
      duration_ms: request.durationMs,
    }))

    return {
      status,
      ...(error ? { error } : {}),
      events,
      artifacts,
      data: { ...data, url: page.url(), startedMono, visibleText: await visibleTextOf(page) },
    }
  }

  /** The page, for assertions that need to look at what is on screen. */
  currentPage(): Page | null {
    return this.page
  }

  /** Where Playwright wrote this run's recording, once the context is closed. */
  async videoPath(): Promise<string | null> {
    const video = this.page?.video()
    if (!video) return null
    try { return await video.path() } catch { return null }
  }

  async close(): Promise<void> {
    // The file is only finalised on context close, so the path is taken first.
    this.pendingVideo = await this.videoPath()
    await this.context?.close().catch(() => {})
    await this.browser?.close().catch(() => {})
    this.context = null
    this.browser = null
    this.page = null
  }

  /** The finished recording, available after `close()`. */
  recordedVideo(): string | null {
    return this.pendingVideo
  }

  /**
   * Where Playwright wrote the HAR, available after `close()` — it is flushed
   * with the context, exactly like the video.
   */
  recordedHar(): string | null {
    return this.options.harPath ?? null
  }

  private async perform(
    page: Page,
    step: PlanStep,
    args: PlanArgs,
    timeout: number,
    ctx: RunContext,
  ): Promise<Record<string, unknown>> {
    switch (step.action) {
      case 'goto': {
        const target = has(args, 'url') ? readString(args, 'url') : readString(args, 'path', '/')
        const url = /^https?:\/\//.test(target) ? target : new URL(target, ctx.baseUrl ?? 'http://127.0.0.1').toString()
        const response = await page.goto(url, { timeout, waitUntil: 'load' })
        return { status: response?.status() }
      }
      case 'click':
        await this.locator(page, args).click({ timeout })
        return {}
      case 'fill': {
        const value = readString(args, 'value', '')
        await this.locator(page, args).fill(value, { timeout })
        return { value }
      }
      case 'press':
        await page.keyboard.press(readString(args, 'key', 'Enter'))
        return {}
      case 'select':
        await this.locator(page, args).selectOption(readString(args, 'value', ''), { timeout })
        return {}
      case 'waitFor': {
        if (has(args, 'text')) {
          await page.getByText(readString(args, 'text'), { exact: false }).first().waitFor({ timeout, state: 'visible' })
          return {}
        }
        await this.locator(page, args).waitFor({ timeout, state: readState(args) })
        return {}
      }
      case 'screenshot':
        return {}
      case 'evaluate':
        return { result: await page.evaluate(readString(args, 'expression', '')) }

      case 'caption': {
        // What the frame is *rendering*.
        const text = readString(args, 'text')
        const sub = has(args, 'sub') ? readString(args, 'sub') : undefined
        await applyChrome(page, { title: text, ...(sub ? { sub } : {}) })
        await page.waitForTimeout(readNumber(args, 'holdMs', 900))
        return { caption: text }
      }

      case 'probe': {
        // A value that was *measured* and which the app does not draw. It goes
        // in the dock, under a heading that says so, because captioning an
        // unrendered number as though the frame showed it is how video
        // evidence starts lying.
        const reading: ProbeReading = { label: readString(args, 'label'), value: readString(args, 'value') }
        await applyChrome(page, { probes: [reading] })
        await page.waitForTimeout(readNumber(args, 'holdMs', 900))
        return { probe: reading }
      }

      case 'beat':
        // A pause, so a viewer can read what is on screen.
        await page.waitForTimeout(readNumber(args, 'ms', 1400))
        return {}
      default:
        throw new Error(`unhandled action "${step.action}"`)
    }
  }

  /**
   * Prefer accessible role and name: a plan written against a CSS class
   * breaks on a refactor that changed nothing a user can see, and a plan is
   * meant to be reviewable by a human.
   */
  private locator(page: Page, args: PlanArgs) {
    if (has(args, 'role')) {
      const name = has(args, 'name') ? readString(args, 'name') : undefined
      return page.getByRole(readString(args, 'role') as Parameters<Page['getByRole']>[0], { name }).first()
    }
    if (has(args, 'label')) return page.getByLabel(readString(args, 'label')).first()
    if (has(args, 'text')) return page.getByText(readString(args, 'text'), { exact: false }).first()
    if (has(args, 'testId')) return page.getByTestId(readString(args, 'testId')).first()
    if (has(args, 'selector')) return page.locator(readString(args, 'selector')).first()
    throw new Error('a web step needs one of: role+name, label, text, testId or selector')
  }

  private async capture(page: Page, step: PlanStep, ctx: RunContext): Promise<StoryArtifact[]> {
    const store = this.options.store
    if (!store) return []
    const artifacts: StoryArtifact[] = []
    const prefix = String(step.seq).padStart(4, '0')

    try {
      // The agent-readable artefact: structure and text, not pixels.
      const snapshot = await page.locator('body').ariaSnapshot({ timeout: 5_000 })
      const written = store.writeText(
        { kind: 'snapshot', name: `a11y/${prefix}-after.yaml`, readableBy: ['agent'], stepSeq: step.seq },
        snapshot,
      )
      if (written) artifacts.push(written)
    } catch (error) {
      ctx.log(`web: could not capture an accessibility snapshot for step ${step.seq}: ${(error as Error).message}`)
    }

    try {
      const shot = await page.screenshot({ timeout: 5_000 })
      const written = store.writeBinary(
        { kind: 'screenshot', name: `frames/${prefix}-after.png`, readableBy: ['human'], stepSeq: step.seq },
        shot,
      )
      if (written) artifacts.push(written)
    } catch (error) {
      ctx.log(`web: could not capture a screenshot for step ${step.seq}: ${(error as Error).message}`)
    }

    if (this.consoleLines.length > 0) {
      const written = store.writeText(
        { kind: 'console', name: `console/${prefix}.log`, readableBy: ['agent'], stepSeq: step.seq },
        `${this.consoleLines.join('\n')}\n`,
      )
      if (written) artifacts.push(written)
    }

    return artifacts
  }

  private async ensurePage(ctx: RunContext): Promise<Page> {
    if (this.page) return this.page
    const { chromium } = await import('playwright')
    this.browser = await chromium.launch({ headless: this.options.headless ?? true })
    const videoDir = this.options.videoDir
    if (videoDir) mkdirSync(videoDir, { recursive: true })
    const viewport = this.options.viewport ?? { width: 1280, height: 720 }
    // Playwright writes both of these itself, and flushes them when the
    // context closes. Building a HAR from route interception instead would
    // see no timing phases and no failed transports — the two things a
    // network bug is usually made of.
    const harPath = this.options.harPath
    this.context = await this.browser.newContext({
      viewport,
      ...(videoDir ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
      ...(harPath ? { recordHar: { path: harPath, mode: 'full', content: 'embed' } } : {}),
    })

    // One traceparent per request, not one per session: the point is to link
    // a *specific* UI action to the server frame it caused.
    await this.context.route('**/*', async (route) => {
      const spanId = newSpanId()
      const request = route.request()
      const startedMono = ctx.monoNs()
      const record: RequestRecord = {
        method: request.method(),
        url: request.url(),
        spanId,
        durationMs: 0,
        startedMono,
      }
      this.requests.push(record)
      try {
        const response = await route.fetch({
          headers: { ...request.headers(), traceparent: traceparent(ctx.traceId, spanId) },
        })
        record.status = response.status()
        record.durationMs = Math.max(0, (ctx.monoNs() - startedMono) / 1e6)
        await route.fulfill({ response })
      } catch (error) {
        // A route that throws aborts the page load, which would look like an
        // application failure rather than a harness one.
        ctx.log(`web: request to ${request.url()} could not be proxied: ${(error as Error).message}`)
        await route.continue().catch(() => {})
      }
    })

    this.page = await this.context.newPage()
    resetChrome(this.page)
    this.page.on('console', (message: ConsoleMessage) => {
      this.consoleLines.push(`[${message.type()}] ${message.text()}`)
    })
    this.page.on('pageerror', (error: Error) => {
      this.consoleLines.push(`[pageerror] ${error.message}`)
    })
    return this.page
  }
}

const WAIT_STATES = ['attached', 'detached', 'visible', 'hidden'] as const
type WaitState = (typeof WAIT_STATES)[number]

function readState(args: PlanArgs): WaitState {
  const state = readString(args, 'state', 'visible')
  if (!(WAIT_STATES as readonly string[]).includes(state)) {
    throw new TypeError(`plan argument "state" must be one of ${WAIT_STATES.join(', ')}, got "${state}"`)
  }
  return state as WaitState
}

/**
 * What a user would see, captured with the step rather than read back later.
 *
 * An assertion that reads the live page cannot be re-evaluated from a sealed
 * story, which is what stories exist for — and it breaks outright the moment
 * recording is on, because flushing the video closes the context the page
 * lived in. Capturing here costs one call per step and makes the assertion
 * answerable offline.
 */
async function visibleTextOf(page: Page): Promise<string> {
  return (await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')) || ''
}

function safePath(url: string): string {
  try { return new URL(url).pathname } catch { return url }
}
