import type { Page } from 'playwright'

/**
 * The recording overlay: what a viewer reads while the video plays.
 *
 * Two kinds of text, kept apart on purpose:
 *
 *  - a **caption** narrates what the frame is *rendering*, in the bar across
 *    the top;
 *  - a **probe** reports a value that was *measured* and which the app does
 *    not draw, in the dock down the side, under a heading that says so.
 *
 * Captioning an unrendered value as though the frame showed it is the way
 * video evidence goes wrong — a frame captioned "38 rows selected" over a UI
 * that drew no selection. The dock reads as an instrument panel beside the
 * app rather than as part of it, so the honest option is also the easy one.
 *
 * Nothing is drawn along the bottom edge: a player's scrubber and play button
 * sit there and would cover it.
 */

export const CHROME_ID = 'witness-chrome'
export const BAR_HEIGHT = 68
export const DOCK_WIDTH = 340
/** Older readings stay for context, but the dock cannot grow without bound. */
export const MAX_PROBES = 8

export interface ProbeReading {
  label: string
  value: string
}

export interface ChromeState {
  title: string
  sub?: string
  probes: ProbeReading[]
}

export interface ChromeUpdate {
  title?: string
  sub?: string
  /** Prepended to the dock; the newest reading sits at the top. */
  probes?: ProbeReading[]
}

const chromeOf = new WeakMap<Page, ChromeState>()

export function chromeState(page: Page): ChromeState {
  let state = chromeOf.get(page)
  if (!state) {
    state = { title: '', probes: [] }
    chromeOf.set(page, state)
  }
  return state
}

export function resetChrome(page: Page): void {
  chromeOf.set(page, { title: '', probes: [] })
}

/**
 * Paint the overlay, and keep painting it after a navigation.
 *
 * A full load throws the overlay away with the old document, so a caption set
 * before a `goto` would record as a blank gap — an entire beat filmed with no
 * caption at all. The init script runs before `<body>` exists, hence the
 * second paint on DOMContentLoaded; the painter no-ops until there is a body.
 */
export async function applyChrome(page: Page, update: ChromeUpdate): Promise<void> {
  const state = chromeState(page)
  if (update.title !== undefined) {
    state.title = update.title
    state.sub = update.sub
  }
  if (update.probes?.length) {
    state.probes = [...update.probes, ...state.probes].slice(0, MAX_PROBES)
  }

  const args = { ...state, id: CHROME_ID, bar: BAR_HEIGHT, dock: DOCK_WIDTH }
  const call = `(${drawChrome.toString()})(${JSON.stringify(args)})`
  await page.addInitScript({
    content: `${call};document.addEventListener("DOMContentLoaded",()=>{${call}});`,
  })
  await page.evaluate(drawChrome, args)
}

interface DrawArgs extends ChromeState {
  id: string
  bar: number
  dock: number
}

/**
 * Serialised into the page, so it must be self-contained: no imports, no
 * closure over anything outside its argument.
 */
function drawChrome(args: DrawArgs): void {
  if (!document.body) return
  const existing = document.getElementById(args.id)
  if (existing) existing.remove()

  const esc = (raw: string) =>
    String(raw).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)

  // The bar would otherwise sit on top of the first ~68px of the page — which
  // is exactly where a confirmation banner tends to appear. Covering the thing
  // the recording exists to show is worse than shifting the layout, so the
  // document is pushed down by the height of the bar and put back when the
  // caption clears.
  const shift = args.title ? `${args.bar}px` : ''
  document.body.style.setProperty('margin-top', shift)

  // The chrome lives in a *closed* shadow root, and that is load-bearing
  // rather than tidiness. In the light DOM its caption text is part of the
  // page: `body.innerText()` includes it, and a `waitFor { text }` step
  // matches it. An agent filming a reproduction had its wait resolve in 72ms
  // against the tool's own caption instead of the state it was waiting for,
  // and got a "before" recording that showed no bug at all — the harness
  // fabricating the evidence it exists to collect. A closed root still
  // renders, so the recording keeps the caption, but no locator and no
  // innerText can see it.
  const host = document.createElement('div')
  host.id = args.id
  host.setAttribute('data-witness', 'chrome')
  host.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'pointer-events:none',
    "font-family:-apple-system,system-ui,'Segoe UI',sans-serif",
  ].join(';')

  const root = host.attachShadow({ mode: 'closed' })
  // The rendered markup, mirrored onto the host as an attribute. A closed
  // root is unreadable by design — which is the point, and also means a test
  // cannot check that the caption says what it should. This is the seam for
  // that: readable from outside, and still invisible to `innerText` and to
  // every locator, because attributes are not text.
  const rendered: string[] = []

  if (args.title) {
    const bar = document.createElement('div')
    bar.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'right:0',
      // border-box, so the bar is exactly as tall as the space the document
      // was shifted by — otherwise padding pushes it over the page again.
      'box-sizing:border-box',
      `min-height:${args.bar}px`,
      'display:flex',
      'flex-direction:column',
      'justify-content:center',
      'gap:2px',
      'padding:10px 22px',
      'background:linear-gradient(180deg,rgba(8,11,20,.94),rgba(8,11,20,.82))',
      'color:#fff',
      'box-shadow:0 2px 18px rgba(0,0,0,.35)',
    ].join(';')
    rendered.push(args.title, ...(args.sub ? [args.sub] : []))
    bar.innerHTML =
      `<div style="font-size:20px;font-weight:650;letter-spacing:-.01em">${esc(args.title)}</div>` +
      (args.sub ? `<div style="font-size:14px;opacity:.75">${esc(args.sub)}</div>` : '')
    root.appendChild(bar)
  }

  if (args.probes.length > 0) {
    const dock = document.createElement('div')
    // Top-anchored and short of the bottom: the player's controls own that
    // strip, and anything drawn there is invisible in the finished file.
    dock.style.cssText = [
      'position:absolute',
      `top:${args.title ? args.bar + 14 : 14}px`,
      'right:14px',
      `width:${args.dock}px`,
      'max-height:62%',
      'overflow:hidden',
      'padding:12px 14px',
      'border-radius:10px',
      'background:rgba(8,11,20,.9)',
      'border:1px solid rgba(148,163,184,.35)',
      'color:#e2e8f0',
    ].join(';')

    const heading =
      '<div style="font-size:10px;letter-spacing:.14em;font-weight:700;color:#fbbf24;margin-bottom:8px">' +
      'MEASURED — NOT RENDERED BY THE APP</div>'

    const rows = args.probes
      .map((probe, index) => {
        const fresh = index === 0
        return (
          `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;` +
          `border-top:${index === 0 ? '0' : '1px solid rgba(148,163,184,.18)'};` +
          `opacity:${fresh ? '1' : '.62'}">` +
          `<span style="font-size:12px">${esc(probe.label)}</span>` +
          `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;` +
          `font-weight:${fresh ? '700' : '400'};color:${fresh ? '#fff' : '#cbd5e1'}">${esc(probe.value)}</span>` +
          '</div>'
        )
      })
      .join('')

    rendered.push('MEASURED — NOT RENDERED BY THE APP', ...args.probes.flatMap((p) => [p.label, p.value]))
    dock.innerHTML = heading + rows
    root.appendChild(dock)
  }

  host.setAttribute('data-witness-rendered', JSON.stringify(rendered))
  document.body.appendChild(host)
  // Geometry mirrored for the same reason as the text: a closed root cannot
  // be measured from outside, and "does the chrome cover the page, or the
  // player controls?" has to stay answerable.
  host.setAttribute(
    'data-witness-boxes',
    JSON.stringify(
      Array.from(root.querySelectorAll('*'))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => ({ top: r.top, bottom: r.bottom, height: r.height })),
    ),
  )
}
