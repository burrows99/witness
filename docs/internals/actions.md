# actions

`src/actions/` — what a product can *do*, executed.

| file | |
|---|---|
| `engine.ts` (815) | the step dispatcher, and the `StepConfig` / `ActionConfig` types |
| `run.ts` (326) | `action run`: lanes, retries, parallel panes, terminal short-circuit |

## engine

One method per verb, dispatched on which key the step object has. It holds no product knowledge:
routes, locators, operations and queries all come from the config.

**Per-run state is not on the instance.** `type Running = { warning?, ran?, notices: string[] }` is
threaded through a run instead, because `--parallel` runs several at once through the same engine and
instance fields made two lanes share a warning.

**Evidence paths are threaded too** — `type Within = { from?, at?, quiet? }`. A `run` step passes its
own directory down, which is how a composed action's frames land inside the step that ran it.

**`upload` bridges two elements, not one.** A styled dropzone is a `<div>` with the real
`<input type="file">` hidden inside it, and the half a person has a name for is the visible one — no
role and no label reaches a control that is `display: none`. So `to` may name either: the input
inside what was named is preferred, and what was named is used when there is none. Both ways of
being wrong get their own message, because they want opposite fixes — a `to` that matches nothing is
a misspelt name, and a `to` that matches something with no file input in it is the right name one
element off, which Playwright answers with a sentence about an HTMLInputElement.

**Values gather into one bag.** Every `store`, `api`, `query`, `capture` and `select` writes into it
under its `as`, and every string in a later step is a template over it. Dotted, so `{order.items.1.sku}`
works, and objects fill as JSON rather than `[object Object]`.

**One name, three ways of writing it.** `resolveAction(actions, name, from?)` is the only place that
decides: as declared; a sibling's bare name from inside the same service; and, only from outside one,
the bare name of an action exactly one service declares. Everything that runs an action by name goes
through it — the engine, the runner before it opens a browser, and `check drift`.

## run

- **a name** → resolved before anything else, so nothing is launched and nothing is written for one
  that names nothing (#141)
- **one action** → one browser, one recording
- **several** → one browser, in order, one continuous recording (a chain is one story)
- **`--parallel`** → one `Lane` each, stitched into panes; lanes cannot pass values
- **`--retries=N`** → a fresh lane per attempt, `<action>-retry-N`, the failure's evidence kept
- **`records: "terminal"`** short-circuits before any browser is opened

Three things live in the `finally`, not the `catch`: the slide cards, the catalogue, and the render.
A failing run is exactly when the evidence matters, and cards spliced only on success is a bug this
had.
