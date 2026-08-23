# browser

`src/browser/` — everything that needs Playwright, and nothing else does.

| file | |
|---|---|
| `playwright.ts` (40) | the optional peer, imported lazily |
| `locator.ts` (85) | `LocatorSpec` → a Playwright locator, and back to a human string |
| `screen.ts` (38), `surface.ts` (21), `web-app.ts` (28) | a route, an app, and the map between |
| `sign-in.ts` (96) | magic-link sign-in, described rather than coded |
| `identities.ts` (32) | the cookies every context this tool opens carries |
| `narration.ts` (188) | caption, beat, slide, pane — drawn *into* the page |

## The optional peer

`playwright()` resolves lazily; `requirePlaywright()` throws a sentence saying to install it. Nothing
imports `@playwright/test` at the top of a file, because half of what this package does has nothing
to do with a browser and a top-level import would make it a hard dependency in practice.

## locator

The field order in `LocatorSpec` is the order to prefer them in: a role and its accessible name is
what a person sees; a CSS selector is what survives worst. `describe()` turns a spec back into the
string a human reads in a failure and a drift report.

`exact` applies to whichever of `name`/`label`/`placeholder`/`text` is used — Playwright matches all
of them by substring, which is how a field called "Password" also matches "Show password".

## narration

The commentary is drawn into the page, so it is part of what the recorder captures and survives any
later stitching. A recording of a browser moving at machine speed proves nothing to a reviewer: they
cannot see what was clicked or why it mattered.

`markRecordingStart` / `slideMarks` record *when* each slide appeared, so `evidence/recording.ts` can
rasterise a full-frame card and the stitcher can splice it at the right timestamp — rather than
painting the same title into every pane, which reads as several things happening at once.
