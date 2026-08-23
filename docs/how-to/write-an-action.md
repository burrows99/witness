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
`web.cancelOrder` from outside, and `cancelOrder` to its siblings.

## Get somewhere, do something, claim something

```jsonc
{ "goto": { "route": "order", "params": { "orderId": "{orderId}" } } },
{ "click": { "role": "button", "name": "Cancel order" } },
{ "expect": { "on": { "text": "Refund on its way" }, "because": "the customer is told, not just the ledger" } }
```

`because` becomes the failure message. It is the only sentence anyone reads when it breaks, so write
it for that moment.

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
- **`expect` passing is not the same as evidence.** A `css` match can succeed on a node that is
  off-screen: the run goes green and the picture shows nothing.
- **`waitForUrl` takes a route, not a URL** — `{ "waitForUrl": { "route": "home" } }`. A literal
  `localhost:3020` disconnects `portVar`.
- **Prefer waiting for a thing over waiting for time.** `wait: 600` after typing into a search box
  stored 226 unfiltered rows here on a slow run, and the assertion under it was loose enough to pass.

See [reference/steps.md](../reference/steps.md) for every verb.
