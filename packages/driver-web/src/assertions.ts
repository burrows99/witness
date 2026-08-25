import { has, readString, type AssertionKind, type AssertionResult, type StoryView } from '@swe-verify/core'
import type { WebDriver } from './driver.js'

/**
 * `ui-text` — what a user would see.
 *
 * It reads the text the driver captured with the step, not the live page. A
 * live read cannot be re-evaluated from a sealed story, and it fails outright
 * whenever recording is on: flushing the video closes the context the page
 * lived in, so every assertion came back `skipped` — a plan that looked like
 * it checked something and checked nothing.
 *
 * On failure it reports what *was* on screen. "Expected 'Order confirmed'"
 * with no sight of the actual page hands the developer a research task.
 */
/**
 * The step's captured text, or the live page when a story is not to hand —
 * the second case is only for a driver used directly, outside a run.
 */
async function visibleText(driver: WebDriver, view: StoryView, step: number): Promise<string | null> {
  const captured = view.stepResult(step)?.data?.visibleText
  if (typeof captured === 'string') return captured
  const page = driver.currentPage()
  if (!page) return null
  return (await page.locator('body').innerText().catch(() => '')) || ''
}

export function uiText(driver: WebDriver): AssertionKind {
  return {
    kind: 'ui-text',
    async evaluate(spec, view, step): Promise<AssertionResult> {
      const expected = has(spec, 'visible') ? readString(spec, 'visible') : readString(spec, 'text', '')
      if (!view.stepResult(step)) {
        return { status: 'skipped', expected, diff: `step ${step} did not run, so there is no page to look at` }
      }
      const body = await visibleText(driver, view, step)
      if (body === null) {
        return { status: 'skipped', expected, diff: `step ${step} captured no page text to assert on` }
      }
      if (body.includes(expected)) return { status: 'pass', expected, actual: expected }

      const visible = body.replace(/\s+/g, ' ').trim().slice(0, 200)
      return {
        status: 'fail',
        expected,
        actual: visible,
        diff: `expected the page to show ${JSON.stringify(expected)}; it showed ${JSON.stringify(visible)}`,
      }
    },
  }
}
