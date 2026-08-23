import * as fs from "node:fs";
import * as path from "node:path";

import type { Browser, Page } from "@playwright/test";

import { slideMarks, resetSlideMarks, type SlideMark } from "../browser/narration.ts";

/**
 * Closing a recording properly, so the video that ships is the one the spec meant.
 *
 * Two things happen here that cannot happen anywhere else:
 *
 *  · PANEL ORDER. A runner names recordings after the page that made them, which puts them in
 *    page-id order — nobody's intended reading. Saving them as `panel-01…` fixes the order the
 *    reviewer will see, left to right.
 *  · THE CARDS. Each slide the spec showed is rasterised ONCE at the size of the finished frame, so
 *    the stitcher can splice a full-frame card into the timeline instead of leaving a title repeated
 *    in every panel — which reads as several things happening at once.
 */
export async function finishRecording(opts: {
  browser: Browser;
  panels: Page[];
  outputDir: string;
  /** How the panels will be laid out, so a card is rasterised at the finished size. */
  layout?: { columns?: number; panelWidth?: number; panelHeight?: number };
}): Promise<void> {
  const { browser, panels, outputDir } = opts;
  fs.mkdirSync(outputDir, { recursive: true });

  for (const [index, page] of panels.entries()) {
    const video = page.video();
    if (!video) continue;
    await video.saveAs(path.join(outputDir, `panel-${String(index + 1).padStart(2, "0")}.webm`));
    // The original stays on disk otherwise, and the stitcher picks up every panel twice.
    await video.delete().catch(() => {});
  }

  const marks = slideMarks();
  if (!marks.length) return;

  const columns = opts.layout?.columns ?? (panels.length >= 4 ? 2 : Math.max(panels.length, 1));
  const rows = Math.ceil(panels.length / columns);
  const width = (opts.layout?.panelWidth ?? 960) * columns;
  const height = (opts.layout?.panelHeight ?? 600) * rows;

  // No recording on this context: it exists only to rasterise the cards.
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const manifest: SlideMark[] = [];
  for (const [index, mark] of marks.entries()) {
    const image = `slide-${String(index + 1).padStart(2, "0")}.png`;
    await page.setContent(card(mark, width));
    await page.screenshot({ path: path.join(outputDir, image) });
    manifest.push({ ...mark, image });
  }
  await context.close();

  fs.writeFileSync(path.join(outputDir, "slides.json"), JSON.stringify(manifest, null, 2));
  // The module outlives one test, so without this the next spec inherits these cards.
  resetSlideMarks();
}

/**
 * Rasterise each slide the run showed, at the size of the finished frame.
 *
 * The other half of `finishRecording`, on its own: the command line saves its own recordings — one per
 * lane, named for the lane — and only needs the cards. Without this, a run's slides stayed painted
 * into each pane, which is a title repeated four times rather than one thing being said.
 */
export async function writeSlideCards(opts: {
  browser: Browser;
  outputDir: string;
  /** How many panes the finished frame has, so a card is drawn at that size. */
  panes: number;
  layout?: { columns?: number; panelWidth?: number; panelHeight?: number };
}): Promise<void> {
  const marks = slideMarks();
  if (!marks.length) return;
  fs.mkdirSync(opts.outputDir, { recursive: true });

  const columns = opts.layout?.columns ?? (opts.panes >= 4 ? 2 : Math.max(opts.panes, 1));
  const rows = Math.ceil(opts.panes / columns);
  const width = (opts.layout?.panelWidth ?? 960) * columns;
  const height = (opts.layout?.panelHeight ?? 600) * rows;

  // No recording on this context: it exists only to rasterise the cards.
  const context = await opts.browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const manifest: SlideMark[] = [];
  for (const [index, mark] of marks.entries()) {
    const image = `slide-${String(index + 1).padStart(2, "0")}.png`;
    await page.setContent(card(mark, width));
    await page.screenshot({ path: path.join(opts.outputDir, image) });
    manifest.push({ ...mark, image });
  }
  await context.close();
  fs.writeFileSync(path.join(opts.outputDir, "slides.json"), JSON.stringify(manifest, null, 2));
  // The module outlives one run, so without this the next inherits these cards.
  resetSlideMarks();
}

/** The full-frame card. Deliberately plain: it is a title, not a screen. */
function card(mark: SlideMark, width: number): string {
  const accent = mark.tone === "bad" ? "#f87171" : mark.tone === "good" ? "#4ade80" : "#7dd3fc";
  const scale = Math.max(1, width / 1280);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0}
    body{background:#0b1220;color:#e2e8f0;font-family:-apple-system,system-ui,sans-serif;
         display:flex;flex-direction:column;justify-content:center;padding:0 8%;gap:${18 * scale}px}
    .kicker{font-size:${15 * scale}px;letter-spacing:.18em;text-transform:uppercase;color:${accent}}
    h1{font-size:${42 * scale}px;font-weight:650;line-height:1.15;margin:0}
    ul{margin:${6 * scale}px 0 0;padding-left:${22 * scale}px;font-size:${20 * scale}px;
       line-height:1.65;color:#cbd5e1}
    li{margin-bottom:${6 * scale}px}
  </style></head><body>
    ${mark.kicker ? `<div class="kicker">${mark.kicker}</div>` : ""}
    <h1>${mark.title}</h1>
    ${mark.lines?.length ? `<ul>${mark.lines.map(line => `<li>${line}</li>`).join("")}</ul>` : ""}
  </body></html>`;
}
