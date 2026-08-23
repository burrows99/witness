/**
 * Redraw the banner from the frames beside it.
 *
 *   node docs/banner/make.mjs
 *
 * The frames are what `witness action run tour` produced, so the picture on the repository is the
 * tool's own output rather than a mock of it. Committed as source because the social preview that was
 * set here once 404'd: nobody could see it, and nobody could remake it.
 */
import { chromium } from "@playwright/test";
import * as path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
await page.goto(`file://${path.join(here, "banner.html")}`);
await page.screenshot({ path: path.join(here, "..", "banner.png") });
await browser.close();
process.stdout.write("wrote docs/banner.png (1280x640, at 2x)\n");
