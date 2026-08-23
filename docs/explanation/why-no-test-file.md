# Why there is no test file

There used to be. A description declared the services, and beside it a `.spec.ts` did the parts the
description could not: assert across two layers, pass a value into a reused sequence, take a still
that was not one-per-step, reach a nested value.

Four gaps, and every one of them turned out to be a step:

| the gap | the step |
|---|---|
| the screen says X **and** the API agrees | `check` — a claim about the values gathered, not the screen |
| run this sequence *with* that value | `run: { action, with }` |
| keep a still named for what it shows | `frame` |
| reach the third field of the second row | dotted templates — `{order.items.1.sku}` |

With those four, every spec file in this repository became a config block, and the concept went away.

## Why that is worth having

**Two artefacts drift.** A description says the route is `/orders/{id}`; a spec hardcodes
`localhost:3000/orders/1`. Both are true on the day they are written. One of them is checked when the
port changes.

**A file of code cannot be swept.** `check drift` verifies every claim the description makes because
the claims are *data* — a locator is a value it can resolve, a route is a value it can visit. The
same sweep over a TypeScript file means executing it, which is just running the suite again, slowly.

**An agent can write a config block.** It cannot reliably write a spec file that compiles, imports
the right helpers, and follows the conventions of a codebase it has read a tenth of. Config has one
shape and a schema; the failure mode is a validation message rather than a plausible file that does
the wrong thing.

**Config is portable.** Description, evidence and CLI move to the next repository as one file.

## The cost

You cannot express arbitrary logic. There is no loop, no branch, no arithmetic. That is deliberate —
each of those, added, would recreate the spec file one field at a time. If a sequence genuinely needs
a program, the library is importable and a test runner is the better host for it.
