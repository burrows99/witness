# browser

`src/browser/` — everything that needs Playwright, and nothing else does.

| file | |
|---|---|
| `playwright.ts` (66) | the optional peer, imported lazily — project first, then the running command |
| `locator.ts` (85) | `LocatorSpec` → a Playwright locator, and back to a human string |
| `screen.ts` (38), `surface.ts` (21), `web-app.ts` (28) | a route, an app, and the map between |
| `sign-in.ts` (96) | magic-link sign-in, described rather than coded |
| `identities.ts` (32) | the cookies every context this tool opens carries |
| `narration.ts` (188) | caption, beat, slide, pane — drawn *into* the page |

## The optional peer

`playwright()` resolves lazily; `requirePlaywright()` throws a sentence saying to install it. Nothing
imports `@playwright/test` at the top of a file, because half of what this package does has nothing
to do with a browser and a top-level import would make it a hard dependency in practice.

It is looked for in two places: the **project** first, so a checkout or an installed dependency drives
the version its own tests and its recorded locators were written against — then **the running command**
(`realpathSync(process.argv[1])`), so a global install reaches `<prefix>/lib/node_modules`, which is
where `npm i -g @playwright/test` puts it. Anchoring only at the working directory made a tool whose
whole pitch is "point it at your stack" demand a dev dependency *of that stack*, which is the intrusion
`--config`-outside-the-repo exists to avoid. It stays a resolution question rather than a dependency
one: the manifest is unchanged, the peer is still optional, and npm still installs nothing on its own —
a bare `npm i -g @burrows99/witness` has no browser and says so. What changed is that the browser can
now be installed once per machine instead of once per project.

`argv[1]` and not `import.meta.url`, which reads better and cannot be used here: a spec transpiled to
CommonJS cannot parse `import.meta`, and this file is reachable from the barrel every spec imports.
`src/index.test.ts` fails the build if that ever stops being true.

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
