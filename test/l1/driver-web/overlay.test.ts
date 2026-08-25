import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { Browser, Page } from 'playwright'
import { isPlaywrightAvailable } from '../../../src/driver-web/driver.js'
import { CHROME_ID, applyChrome, chromeState, resetChrome } from '../../../src/driver-web/overlay.js'

/**
 * The recording overlay.
 *
 * Two kinds of text, and the distinction is the whole point: a caption
 * narrates what the frame is *rendering*; a probe reports a value that was
 * *measured* and which the app does not draw. Captioning an unrendered number
 * as though the frame showed it is the evidence failure this is built to
 * prevent, so the dock says MEASURED on its face.
 */

let server: Server
let baseUrl: string
let browser: Browser
let page: Page

const suite = isPlaywrightAvailable() ? describe : describe.skip

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><body><main><h1>Cart</h1><p id="s">Ready</p></main></body></html>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  if (!isPlaywrightAvailable()) return
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
})

afterAll(async () => {
  await browser?.close()
  await new Promise<void>((r) => server.close(() => r()))
})

/**
 * What the chrome rendered, read from the host rather than from the page.
 *
 * The overlay lives in a closed shadow root so that no locator and no
 * `innerText` can see its caption — a `waitFor { text }` once matched the
 * tool's own narration and resolved instantly, filming a reproduction that
 * showed no bug. That makes it unreadable to a test too, so the rendered
 * strings are mirrored onto an attribute: readable here, still invisible to
 * anything treating the page as text.
 */
const mirrored = async <T>(attribute: string): Promise<T> =>
  JSON.parse((await page.locator(`#${CHROME_ID}`).getAttribute(attribute)) ?? '[]') as T

const overlayText = async (): Promise<string> => (await mirrored<string[]>('data-witness-rendered')).join(' ')

const overlayBoxes = async (): Promise<Array<{ top: number; bottom: number; height: number }>> =>
  await mirrored('data-witness-boxes')

suite('caption — what the frame is rendering', () => {
  it('draws the caption over the page', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { title: '① Place the order', sub: 'the cart totals on the server' })
    expect(await overlayText()).toMatch(/Place the order/)
    expect(await overlayText()).toMatch(/totals on the server/)
  })

  it('replaces the previous caption rather than stacking them', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'first' })
    await applyChrome(page, { title: 'second' })
    const text = await overlayText()
    expect(text).toMatch(/second/)
    expect(text).not.toMatch(/first/)
  })

  it('survives a navigation — a caption set before a goto must not record as a blank gap', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'set before navigating' })
    await page.goto(`${baseUrl}/other`)
    expect(await overlayText()).toMatch(/set before navigating/)
  })

  it('leaves the application markup untouched', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'anything' })
    expect(await page.locator('main h1').innerText()).toBe('Cart')
  })

  it('does not cover the top of the page, where a confirmation tends to appear', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'a caption' })
    const heading = (await page.locator('main h1').boundingBox())!
    const bar = (await overlayBoxes())[0]!
    expect(heading.y, 'the page must start below the caption bar').toBeGreaterThanOrEqual(bar.height - 1)
  })

  it('gives the space back when the caption is cleared', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'a caption' })
    await applyChrome(page, { title: '' })
    const margin: string = await page.evaluate(() => document.body.style.marginTop)
    expect(margin).toBe('')
  })
})

suite('probe — a measured value the app does not render', () => {
  it('labels itself MEASURED, so a reading cannot be mistaken for the UI', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { probes: [{ label: 'rows visible to tenant B', value: '0' }] })
    expect(await overlayText()).toMatch(/MEASURED/)
    expect(await overlayText()).toMatch(/NOT RENDERED/)
  })

  it('shows the reading and its label', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { probes: [{ label: 'resolved notifications', value: '0' }] })
    expect(await overlayText()).toMatch(/resolved notifications/)
  })

  it('keeps earlier readings for context, newest first', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { probes: [{ label: 'first', value: '1' }] })
    await applyChrome(page, { probes: [{ label: 'second', value: '2' }] })
    const text = await overlayText()
    expect(text).toMatch(/first/)
    expect(text).toMatch(/second/)
    expect(text.indexOf('second')).toBeLessThan(text.indexOf('first'))
  })

  it('caps how many it keeps, so the dock cannot grow without bound', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    for (let i = 0; i < 12; i += 1) await applyChrome(page, { probes: [{ label: `p${i}`, value: String(i) }] })
    expect(chromeState(page).probes.length).toBeLessThanOrEqual(8)
  })
})

suite('the overlay stays clear of the player controls', () => {
  it('draws nothing along the bottom edge, where the scrubber sits', async () => {
    resetChrome(page)
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'x', probes: [{ label: 'y', value: 'z' }] })
    const viewport = page.viewportSize()!
    const painted = await overlayBoxes()
    expect(painted.length).toBeGreaterThan(0)
    for (const box of painted) {
      expect(box.bottom, 'nothing may reach the bottom 12% of the frame').toBeLessThan(viewport.height * 0.88)
    }
  })
})

suite('the chrome is invisible to the page it annotates', () => {
  /**
   * The failure this prevents: an agent filming a reproduction wrote a
   * `waitFor { text: "SECONDS_ELAPSED 6" }` step. The recorder's own caption
   * bar rendered that same string into the page, so the wait matched the
   * tool's narration and resolved in 72ms instead of waiting for the state it
   * was about to prove. The "before" recording showed no bug at all — the
   * harness fabricating the evidence it exists to collect.
   *
   * A closed shadow root still renders, so a reviewer sees the caption, but
   * nothing inside the page can read it.
   */
  it('keeps the caption out of the page text', async () => {
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'Wait for SECONDS_ELAPSED 6', probes: [] })
    expect(await page.locator('body').innerText()).not.toContain('SECONDS_ELAPSED')
  })

  it('keeps the caption out of every locator', async () => {
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'Order confirmed', probes: [] })
    // The exact shape of the bug: an assertion matching the tool's own words
    // instead of the application's.
    expect(await page.getByText('Order confirmed').count()).toBe(0)
    expect(await page.locator('text=Order confirmed').count()).toBe(0)
  })

  it('keeps a measured probe value out of the page too', async () => {
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'x', probes: [{ label: 'total', value: '424242' }] })
    expect(await page.locator('body').innerText()).not.toContain('424242')
  })

  it('still renders it, since the recording is the point', async () => {
    await page.goto(baseUrl)
    await applyChrome(page, { title: 'A caption', probes: [] })
    const host = page.locator(`#${CHROME_ID}`)
    expect(await host.count()).toBe(1)
    expect(await host.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')
  })
})
