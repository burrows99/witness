import type { AssertionKind, AssertionResult } from '@swe-verify/core'
import type { WebDriver } from './driver.js'

/**
 * `ui-text` — what a user would see.
 *
 * It reads the live page rather than a stored snapshot, and on failure it
 * reports what *was* on screen. "Expected 'Order confirmed'" with no sight of
 * the actual page hands the developer a research task.
 */
export function uiText(driver: WebDriver): AssertionKind {
  return {
    kind: 'ui-text',
    async evaluate(spec, view, step): Promise<AssertionResult> {
      const expected = String(spec.visible ?? spec.text ?? '')
      if (!view.stepResult(step)) {
        return { status: 'skipped', expected, diff: `step ${step} did not run, so there is no page to look at` }
      }
      const page = driver.currentPage()
      if (!page) {
        return { status: 'skipped', expected, diff: 'no browser page is open' }
      }

      const body = (await page.locator('body').innerText().catch(() => '')) || ''
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
