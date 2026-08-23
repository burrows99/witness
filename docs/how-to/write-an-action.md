# Write an action

An action is a sequence somebody performs, its narration, and its claims — declared, not programmed.

## The shape

```jsonc
"services": { "web": { "actions": {
  "cancelOrder": {
    "summary": "cancel an order and check the refund really landed",
    "inputs": ["orderId"],
    "steps": [ … ]
  }
} } }
```

Written under the service it is about, so it needs no `app` and no `web.` in its own name. It is
`web.cancelOrder` from outside, and `cancelOrder` to its siblings — and to the command line, which
takes the bare name whenever exactly one service declares it.

**It does not have to be typed into the file by hand.** `action add` takes the action — or just its
step list — validates every step against the verbs the runner actually dispatches on, and puts it
where the name says it belongs:

```bash
npx witness action add web.cancelOrder --from=steps.jsonc
npx witness action add web.cancelOrder --from=-        # or down a pipe
npx witness action rm  web.cancelOrder
```

A refusal leaves `.witness/config.jsonc` byte-identical and says what was wrong with the step list;
the comments already in that file are left exactly where they are; and adding the same action twice is
one action. See [reference/cli.md](../reference/cli.md#config-merge-config-set-action-add-action-rm).

## Get somewhere, do something, claim something

```jsonc
{ "goto": { "route": "order", "params": { "orderId": "{orderId}" } } },
{ "click": { "role": "button", "name": "Cancel order" } },
{ "expect": { "on": { "text": "Refund on its way" }, "because": "the customer is told, not just the ledger" } }
```

`because` becomes the failure message. It is the only sentence anyone reads when it breaks, so write
it for that moment.

## Start where the app starts

Some apps have nothing to click until something has been attached. A landing screen that is a
dropzone plus a prompt box links nowhere, and every other route takes an id that only exists once a
file has been uploaded:

```jsonc
{ "upload": "seed.pdf", "to": { "testId": "dropzone" } },
{ "type": { "on": { "placeholder": "Ask about this document" }, "value": "{prompt}" } },
{ "click": { "role": "button", "name": "Submit" } }
```

The file lives in `.witness/fixtures/seed.pdf` — a filename, not a path, so the description finds
the same file in the next checkout. `to` names the dropzone a person can see; the hidden
`<input type="file">` inside it is what actually gets the file. An array attaches several.

## Claim it at the layer it is about

`expect` sees the screen. `check` sees the values the run has gathered:

```jsonc
{ "api": { "operation": "orders.show", "params": { "orderId": "{orderId}" }, "as": "order" } },
{ "check": { "that": "{order.status}", "equals": "REFUNDED", "because": "the screen and the API must agree" } },
{ "query": { "name": "order.status", "as": "stored" } },
{ "check": { "that": "{stored}", "contains": "REFUNDED", "because": "and so must what was written down" } }
```

That pair is why an action needs no program: *the screen says X and the API agrees* is a claim about
two layers at once.

## Compose

```jsonc
{ "run": "signIn" },
{ "run": { "action": "browseConnections", "with": { "search": "prometheus" } } }
```

A composed action stays usable on its own, and its evidence lands **inside the step that ran it** —
`cancelOrder/02-signIn/`.

## Narrate

```jsonc
{ "slide": { "title": "Refunding an order", "kicker": "before", "lines": ["What the customer sees."] } },
{ "caption": { "text": "About to cancel", "sub": "why it matters" } },
{ "frame": "the order, cancelled" }
```

`slide` is a full-frame card spliced into the video. `caption` is a moment. `frame` keeps a still
named for what it shows, beside the automatic one-per-step.

## Leave the note

```jsonc
"verify": {
  "title": "What this shows",
  "subject": { "account": "{secret.adminUser}", "orders": "{stats.orders}" },
  "notes": ["The API reported {stats.orders} orders."]
}
```

Every value is a template filled from what the run gathered, written whether the run passed or failed.

## Things that cost other people an afternoon

- **A locator you have not run is a guess.** Five of the first nine actions written against Grafana
  here named something that did not exist. Use `npx playwright codegen <url>`, then run it and read
  the frame the story names.
- **A step verb you misspelled does nothing, silently.** The runner dispatches one `if` per verb, so
  `{ "clik": … }` is not an error — it is no step at all, and the action runs green having moved
  nothing. `action add` refuses one before it is written; a step typed straight into the file is not
  checked by anything until something looks at the frames and cannot see why they are identical.
- **`expect` passing is not the same as evidence.** A `css` match can succeed on a node that is
  off-screen: the run goes green and the picture shows nothing.
- **Neither is a run that finishes.** Fourteen steps against a fast local app are over in two
  seconds, which is a tenth of a second on screen each: the frames genuinely differ, and what plays
  is a blank screen and then the end state. `debug.md` says so under `## What it got away with`
  whenever a run's steps average less than a third of a second of recording each, and `slide`,
  `caption` and `wait` are what it is telling you to reach for.
- **`waitForUrl` takes a route, not a URL** — `{ "waitForUrl": { "route": "home" } }`. A literal
  `localhost:3020` disconnects `portVar`. Somewhere that is not this app at all — the identity
  provider a sign-in hands the browser to — is `{ "waitForUrl": { "service": "keycloak" } }`, the
  same idea one service along. See [reference/steps.md](../reference/steps.md#a-sign-in-that-leaves-the-app).
- **A fixture belongs in `.witness/fixtures/`, not in your Downloads.** An `upload` step takes a
  filename and resolves it there. An absolute path works on exactly one machine, which is the one
  failure this convention exists to rule out.
- **Prefer waiting for a thing over waiting for time.** `wait: 600` after typing into a search box
  stored 226 unfiltered rows here on a slow run, and the assertion under it was loose enough to pass.

See [reference/steps.md](../reference/steps.md) for every verb.
