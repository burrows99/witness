import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { Browser, Page } from 'playwright'
import { isPlaywrightAvailable } from '../../src/driver.js'
import { CHROME_ID, applyChrome, chromeState, resetChrome } from '../../src/overlay.js'

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

const overlayText = () => page.evaluate((id) => document.getElementById(id)?.innerText ?? '', CHROME_ID)

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
    const bar = (await page.locator(`#${CHROME_ID} > div`).first().boundingBox())!
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
    const boxes = await page.evaluate((id) => {
      const root = document.getElementById(id)
      const elements = Array.from(root?.querySelectorAll('*') ?? [])
      return elements.map((el) => {
        const r = el.getBoundingClientRect()
        return { bottom: r.bottom, height: r.height }
      })
    }, CHROME_ID)
    const painted = boxes.filter((b) => b.height > 0)
    expect(painted.length).toBeGreaterThan(0)
    for (const box of painted) {
      expect(box.bottom, 'nothing may reach the bottom 12% of the frame').toBeLessThan(viewport.height * 0.88)
    }
  })
})
