# Read what a failing run left behind

The last thing a failing run prints is where to look:

```
what broke, step by step — the network and console of the action that failed, tied to the step:
  .witness/artifacts/cli/…/run/theapp/02-register/debug.md
```

## The story

```md
# customer.cancelOrder — failed at step 3 of 5 (8.4s)

## What it was doing
1. ✓ `goto` /orders/1 — 412ms · cancelOrder/01-goto.png
2. ✓ `click` role=button name=Cancel — 180ms · …
3. ✗ `expect` text=Cancelled — 30.0s · …

## Where it broke
**During that step:** 3 requests, **1 of them failed** · the console said 1 thing worth reading
**POST /api/orders/1/cancel** → 500 (412ms) during `click Cancel`
  Sent:       {"reason":null}
  Came back:  {"message":"reason is required"}
> `error` Cannot read properties of undefined (reading 'id') — app.js:12
```

Every request, log and exception is tagged with **the step running when it happened**. That join is
what a person does by hand across three panes, and an agent reading a filesystem cannot do at all.

## The order to look in

1. **`debug.md` of the action that failed** — the step list, then "Where it broke".
2. **The frame from that step.** Open it. A locator that "matches nothing" usually matches something
   with different words, and the frame says which. Four locators in this repository's own example are
   what they are because a frame said so.
3. **`README.md` at the run root** — what is where, and the call tree.
4. **The trace**, for a person: `npx playwright show-trace …/trace.zip`. The story names the path.
5. **`warnings`** in the result — a run can be `ok` and still have something worth reading.

## Before rewriting a locator

```bash
npx witness check drift <sign-in action>
```

If several stopped matching at once, something moved under you and fixing them one run at a time will
take one run each.
