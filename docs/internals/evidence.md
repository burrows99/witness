# evidence

`src/evidence/` — where artefacts go, and what gets written there.

| file | |
|---|---|
| `paths.ts` (88) | the path scheme, derived rather than typed |
| `evidence.ts` (307) | frames, files, `manual-verification.md`, the run `README.md` |
| `recording.ts` (69) | rasterise each slide at the size of the finished frame |
| `render.ts` (28) | after the run: recordings → MP4 |
| `catalogue.ts` (76) | everything the run left on disk, listed in one file |

## Paths are derived

`<artifacts>/cli/<what was run>/<cut>/`. Never typed. Hand-named evidence does not survive a
repository: slugs drift until seven runs share one, frames get hand-numbered until two of them are
`2-`, and the video lands in a third place named after whatever directory something else chose.

Two subtleties the code carries scars from:

- **`slug` per segment**, not over the whole path — slugging the joined string turns
  `<action>/debug.md` into one flat `action-debug.md` and loses the grouping the name expressed.
- **`currentContext()` resolves at use, not at construction.** Resolving eagerly filed every frame
  under `cli/adhoc`.

## Counters and clearing are module-level

A system builds a **new** `Evidence` per call, so per-instance frame counters counted to one and
stopped — eight stills all named `01-`. A directory where everything claims to be first is worse than
one with no numbers.

`freshRun()` clears the run directory **once per process**, on the first write. Clearing per action
plus composed actions writing into each other's directories deleted evidence mid-run: a composed
action wrote its frames, the parent then cleared the tree above it, and `debug.md` pointed at nothing.

## Where things live

`catalogue.ts` was inside the video provider, because rendering happens last and last is when you can
list what exists. That is a reason to *call* it there, not for it to *live* there.
