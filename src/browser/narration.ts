import type { Locator, Page } from "@playwright/test";

/**
 * Turning a run into something a person can watch.
 *
 * A recording of a browser doing things at machine speed proves nothing to a reviewer: they cannot see
 * what was clicked, or why it mattered. These draw the commentary INTO the page, so it is part of what
 * the recorder captures and survives any later stitching or transcoding.
 *
 *   caption()  labels what is on screen NOW
 *   slide()    says what is about to happen, and why it matters
 *   beat()     gives either one enough screen time to be read
 *   typeIn()   types like a person, so the viewer sees text arrive
 */

/** Pin a banner into the page. `sub` is a smaller second line — which tab, which account, which cut. */
export async function caption(
  page: Page,
  text: string,
  sub?: string,
  opts?: { place?: "top" | "bottom" },
): Promise<void> {
  await page.evaluate(
    ({ text, sub, place }) => {
      let el = document.getElementById("__e2e_caption__");
      if (!el) {
        el = document.createElement("div");
        el.id = "__e2e_caption__";
        document.body.appendChild(el);
      }
      // Stops short of the right edge: toasts render top-right, and a full-width banner covers their
      // first line — often the line the assertion is about. `place: "bottom"` is for the screens that
      // put the subject of the caption exactly where the banner sits (an unstyled 404, a page-top error).
      el.style.cssText =
        `position:fixed;${place === "bottom" ? "bottom:0" : "top:0"};left:0;right:auto;max-width:62%;` +
        "z-index:2147483647;background:linear-gradient(180deg,#0f172a,#1e293b);color:#fff;" +
        "font-family:-apple-system,system-ui,sans-serif;padding:10px 16px;" +
        `border-${place === "bottom" ? "top" : "bottom"}-right-radius:8px;` +
        "box-shadow:0 2px 12px rgba(0,0,0,.35);pointer-events:none;";
      el.innerHTML =
        `<div style="font-size:15px;font-weight:600">${text}</div>` +
        (sub ? `<div style="font-size:12px;opacity:.75;margin-top:2px">${sub}</div>` : "");
    },
    { text, sub, place: opts?.place ?? "top" },
  );
}

/** Give a caption or a slide enough screen time to be read. */
export async function beat(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}

/** What a slide was, and when — so a stitcher can splice one full-frame card into the timeline. */
export type SlideMark = {
  title: string;
  lines?: string[];
  kicker?: string;
  tone?: "neutral" | "bad" | "good";
  atMs: number;
  holdMs: number;
  image?: string;
};

let marks: SlideMark[] = [];
let recordingStart = 0;

/**
 * t=0 for slide marks: call it immediately after opening the pages that will be recorded.
 *
 * Without it a mark's timestamp is epoch-milliseconds, and a stitcher told to cut at 1.7e9 seconds
 * emits garbage. A convention that only works when remembered is worth an error instead.
 */
export function markRecordingStart(): void {
  recordingStart = Date.now();
}

export function slideMarks(): SlideMark[] {
  return marks;
}

export function resetSlideMarks(): void {
  marks = [];
  recordingStart = 0;
}

/**
 * A full-screen title card, held for a beat, then removed.
 *
 * Use one before each act of a recording: without them, a before/after pair looks like the same video
 * twice and the difference it exists to show goes unnoticed.
 *
 * Painted on every panel, but that is not what ships — the mark recorded here lets the stitcher cut
 * this window out and splice ONE full-frame card in its place. The per-panel paint covers the panels
 * while the window is open, so any drift between this clock and the recorder's still lands on a card
 * rather than mid-action.
 */
export async function slide(
  pages: Page | Page[],
  title: string,
  lines: string[] = [],
  opts: { ms?: number; kicker?: string; tone?: "neutral" | "bad" | "good" } = {},
): Promise<void> {
  const { ms = 5200, kicker, tone = "neutral" } = opts;
  const panels = Array.isArray(pages) ? pages : [pages];
  if (recordingStart) marks.push({ title, lines, kicker, tone, atMs: Date.now() - recordingStart, holdMs: ms });
  const accent = tone === "bad" ? "#f87171" : tone === "good" ? "#4ade80" : "#7dd3fc";

  for (const page of panels) {
    await page.evaluate(
      ({ title, lines, kicker, accent }) => {
      document.getElementById("__e2e_slide__")?.remove();
      const el = document.createElement("div");
      el.id = "__e2e_slide__";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;background:#0b1220;color:#e2e8f0;" +
        "font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;" +
        "justify-content:center;padding:0 8%;gap:18px;";
      el.innerHTML =
        (kicker
          ? `<div style="font-size:15px;letter-spacing:.18em;text-transform:uppercase;color:${accent}">${kicker}</div>`
          : "") +
        `<div style="font-size:42px;font-weight:650;line-height:1.15">${title}</div>` +
        (lines.length
          ? `<ul style="margin:6px 0 0;padding-left:22px;font-size:20px;line-height:1.65;color:#cbd5e1">` +
            lines.map(l => `<li style="margin-bottom:6px">${l}</li>`).join("") +
            `</ul>`
          : "");
      document.body.appendChild(el);
      },
      { title, lines, kicker, accent },
    );
  }

  await panels[0].waitForTimeout(ms);
  for (const page of panels) {
    await page.evaluate(() => document.getElementById("__e2e_slide__")?.remove());
  }
}

/**
 * A header pinned to the top of a pane, for the whole of it.
 *
 * Four recordings side by side are four things happening at once and no way to tell which is which.
 * A caption is a moment; this is an identity — so it goes in through `addInitScript` and survives
 * every navigation the pane makes, which is the difference between labelling a pane and labelling the
 * first page it happened to load.
 */
export async function pane(page: Page, title: string, sub?: string): Promise<void> {
  const paint = ({ title, sub }: { title: string; sub?: string }): void => {
    const draw = (): void => {
      if (!document.body || document.getElementById("__witness_pane__")) return;
      const el = document.createElement("div");
      el.id = "__witness_pane__";
      el.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:2147483645;background:#312e81;color:#eef2ff;" +
        "font-family:-apple-system,system-ui,sans-serif;padding:5px 12px;pointer-events:none;" +
        "box-shadow:0 1px 0 rgba(255,255,255,.15)";
      // Pushed down rather than covered: the band was sitting over the app's own header, which is
      // often the part that says which app it is.
      document.documentElement.style.setProperty("scroll-padding-top", "34px");
      document.body.style.setProperty("padding-top", "34px", "important");
      el.innerHTML =
        `<div style="font-size:13px;font-weight:650;line-height:1.25">${title}</div>` +
        (sub ? `<div style="font-size:11px;opacity:.75;line-height:1.3">${sub}</div>` : "");
      document.body.appendChild(el);
    };
    draw();
    // The app may not have a body yet, and a single-page app replaces it as it routes.
    document.addEventListener("DOMContentLoaded", draw);
    setInterval(draw, 400);
  };
  await page.addInitScript(paint, { title, sub });
  // And on whatever is already open, because `addInitScript` only affects the next document.
  await page.evaluate(paint, { title, sub }).catch(() => undefined);
}

/**
 * Type one key at a time, so the video shows the text arriving instead of a field that is suddenly full.
 * `fill()` is instant and reads as a bot. The delay scales down for long bodies so a paragraph does not
 * cost the viewer ten seconds of watching a machine type.
 *
 * Never for credentials: those go through `fill()`, so they cannot be read off a frame.
 */
export async function typeIn(locator: Locator, text: string, delay?: number): Promise<void> {
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(text, { delay: delay ?? (text.length > 80 ? 12 : 45) });
}
