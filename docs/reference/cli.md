# CLI

```
npx witness <noun> <verb> [args…] [--flags]
```

No arguments prints every noun and verb this description declares. Results go to **stdout as JSON**;
progress, warnings and the "what broke" pointer go to **stderr**, so `… | jq` works.

`npx witness` is for a project that has this as a dependency — npm links the bin, so the command
resolves. **Inside a checkout of this repository it does not**: npm does not link a package's own
`bin` into its own `node_modules/.bin`, so `npx` misses and goes to the registry for an unrelated
package named `witness`. Run `./bin/witness` there, which is what `/flow`, `docs/agent/` and the
tutorial say.

## Always there

| command | what it does |
|---|---|
| `stack status` | reachability of every service, whether its container is up |
| `check drift [<sign-in action>]` | verify every claim the description makes · exit 1 if any broke |

## There when the description earns it

| command | present when |
|---|---|
| `api <get\|post\|patch\|delete> <operation\|/path> [key=value…] [json]` | any service declares an `api` — a declared operation by name, or any other route on it |
| `db sql "<query>" [--on=<service>]` | a `database` is declared — `--on` names one of the others |
| `video` | rebuild the MP4s from the recordings on disk — a RUN only renders what it just recorded, this re-renders everything |
| `action list` / `action show <a>` / `action run <a…>` | any action is declared |
| `stub list` / `stub show <s>` | any `stubs` are declared |
| `config explore [<service>] [--as=<action>] [--pages=N] [--depth=N]` | always — walks the app and prints the description it implies |
| `config merge <file\|->` / `config set <field> <value>` | always — the writing half: a block, or one field |
| `action add <name> --from=<file\|->` / `action rm <name>` | always — `add` is how a description gets its first action |
| `init` | always — writes `.witness/`, populated from the compose file when there is one |
| `skill [--write]` | always — the instructions, generated from what this copy can do; `--write` refreshes `.witness/SKILL.md` in place |
| *your own nouns* | each entry in the `cli` block |

## `api`

```
npx witness api get <operation|/path> [key=value…] [json]
```

The argument is **an operation's name first, and a path second**: the `api.operations` block is the
list of everything this description can ask the running app, and calling one by name is what it is
for. `key=value` supplies that operation's parameters, the same way `action run` supplies an action's
inputs — `api get getReport reportId=7`.

A **path starts with `/`** and is the escape hatch it always was: any route, authenticated with the
same credential a declared operation would use. Reach for it twice for the same route and give it a
name in the config instead.

Anything that is neither is a mistake worth naming, so it says so — with the operations that do
exist — rather than sending it. A named operation carries its own method, so the verb is how the
command is typed rather than what goes on the wire; `get` is the one to reach for.

## `action run`

```
npx witness action run <action…> [key=value…] [--parallel] [--retries=N]
```

- **several actions** run in one browser, in order, as one continuous recording
- `--parallel` gives each its own browser and stitches them into panes ([how-to](../how-to/run-things-in-parallel.md))
- `--retries=N` re-runs a failure in a fresh browser, keeping each attempt's evidence
- `key=value` supplies the action's `inputs`
- `HEADED=1` shows the browser
- **a name is answered for first** — an action under a service can be named `<service>.<name>` or, when
  only one service declares that name, bare; anything else is refused before a browser is opened, and
  leaves no evidence directory behind

Exit code is 1 if any action failed — a chain where only one of them broke, a `--parallel` run where
only one lane did. The result is still printed and the evidence still written: the code is set on the
way out, not exited on, because a red that costs the reader the frames is worse than the green it
replaces. So a `before` cut of a bug is *meant* to be a 1, and the frames are what to read next.

## `config explore`

```
npx witness config explore [<service>] [--as=<action>] [--pages=12] [--depth=2]
```

Crawls same-origin from the routes already declared (or `/`), carrying the config's identity cookies,
and prints a JSONC fragment: `routes` and `locators` from each page's aria snapshot, `forms` from the
fields it found, `api.operations` from the XHR the app made while being walked. It never writes the
config itself — a generated name is worse than the one you would choose — so rename and trim, then
apply what is left with `config merge -`, which takes exactly this shape. What the caps left out is
printed, not dropped silently.

**`--as` names an action to run first** — any declared action, resolved the way `action run` resolves a
name. It is driven on the page the crawl then walks with, so everything it leaves behind is what every
navigation after it carries: the cookie jar, whatever it wrote on the server, the URL it landed on.
The one shape refused is a `records: "terminal"` action, because it has no screen to leave the crawl
on. The requests the action itself makes are not collected as `operations` — that action is already
described, and folding them in would make the block depend on whether `--as` was passed.

**A sign-in is the commonest one and not the only one.** Anything that leaves the app in the state
worth describing does the same job: an upload, a seed, a first record. Without one, a crawl of an app
whose value is behind a gate describes the gate and stops — a login page, or a landing screen that
links nowhere until a file has been dropped on it and every other route is behind an id the upload
would have minted. `Walked 1 page` is nearly always a gate rather than a small app.

**A field is found by being a field**, not by carrying a placeholder — `input`, `textarea` or `select`,
laid out, and inside a `form` where the page has one; a button, a checkbox and a hidden token are not
fields to fill. A `forms` entry is still a placeholder, because that is what `getByPlaceholder` takes,
so fields without one are named separately in the fragment with their labels and belong in a
`fillFields` step. And a crawl where every page walked carried a password field says so: `Walked 1 page`
otherwise reads as "this app is small" rather than "I could not get in".

**A fragment is meant to be committed, so it describes screens rather than rows.** A path segment
that is an id collapses to `{id}` — in routes now as well as in operations — a page is recorded where
it **landed** rather than where it was asked for, a form found twice is written once, a field is named
for what it IS (`name`, `aria-label`, its label) and valued with the placeholder that finds it, and a
locator is not named after a number the app rendered. Two runs against an unchanged app produce the
same bytes; anything less and `check drift` inherits the wobble and a regenerated fragment diffs as
churn.

Each page is read once it has **settled**, not once its document is done — a client-rendered app is an
empty shell at `domcontentloaded`. A page that still offers nothing is named in the fragment: an empty
page is nearly always one behind a sign-in, not one with nothing on it.

**It walks your app and nothing else.** A sign-in that hands off — `/login/generic_oauth`,
`/user/oauth2/keycloak`, `/api/auth/idp/microsoft/start` — is a link on your own origin that answers
302 to an identity provider, so those shapes are skipped before anything is requested. Whatever else
turns out to have left this origin is judged on where the navigation **landed**, and dropped rather
than read: a description that named the third party's screens would be describing somebody else's
product. Both kinds are named in the fragment, so a route you do want described can be declared by
hand.

## `config merge`, `config set`, `action add`, `action rm`

```
npx witness config explore web | npx witness config merge -   # a fragment, applied
npx witness config merge fragment.jsonc
npx witness config set services.web.port 3001
npx witness action add web.checkout --from=steps.jsonc
npx witness action rm  web.checkout
```

The half that writes. Everything else here prints or reads, so before these existed the only way to
change a description that already existed was to edit `.witness/config.jsonc` — which for an agent
means splicing strings, with the anchor's uniqueness checked by hand, the indentation counted by hand,
and nothing validating the result until the next command happened to load it.

Three properties, and they matter more than the spelling of the verbs.

**Validated before written.** The result is read back with the same reader every other command uses,
before anything reaches the disk — so a refusal leaves the file **byte-identical** and says what was
wrong with the input rather than what broke two minutes into a browser run. A step naming a verb that
does not exist is the one worth naming: the runner dispatches one `if` per verb and does nothing at all
with a key it does not know, so `{ "clik": … }` runs green, photographs the screen it did not touch,
and reports a passing action. `action add` refuses it and lists the verbs there are.

**Comments survive.** The comments in a description are its documentation — `init`'s header,
`explore`'s notes, whatever you wrote — so nothing is reprinted. The file is edited in place by offset,
and every byte outside the span actually being changed comes out exactly as it went in, indentation
and blank lines included. Two things follow, and they are real costs rather than footnotes: a value
that is **replaced** loses the comments *inside it* (an array, a step list included, is replaced whole
— nothing can say whether the step at index 3 is the same step), and a **fragment's own comments do
not travel**, because `explore`'s header is a report about a crawl with nowhere honest to live in the
file. A description that does not parse is refused rather than spliced at a guess.

**Idempotent and addressable.** A field already saying what you asked for is not rewritten — not even
identically — so the same `action add` twice is one action, and a regenerated `explore` fragment merged
a second time is not churn in the diff. You name WHAT to change and never where it sits in the text.

- `config merge` is deep for blocks and wholesale for everything else: a fragment naming
  `services.web.app.routes` will not delete the `api` it never mentioned.
- `config set` takes a scalar or a list. A block is refused and pointed at `merge`, because "set this
  field to this object" has two readings and a verb whose meaning depends on what is already in the
  file is what this surface exists to stop being. A key with a dot **in its own name** can only be
  reached with `merge`.
- `action add <service>.<name>` writes it under that service, where it needs no `app` and no prefix
  typed into its own name; a bare name goes to the top-level `actions` block. It takes the whole
  action or the step list on its own.
- `action rm` takes the note written directly above it — prose about something that is not there is
  worse than none — and takes the `actions` block too when that was the last thing in it. A bare name
  is answered for the way `action run` answers one, and refuses to guess between two services.
- **`config merge` and `config set` answer without a description that loads.** A fresh `init` writes a
  template that does not load until it is cut down, which is exactly when a writer is worth having.
  `action add` and `action rm` need one that does.

## Your own nouns

```jsonc
"cli": { "orders": { "summary": "the order book", "verbs": {
  "show":   { "args": ["orderId"], "operation": "orders.show" },
  "recent": { "args": ["limit"], "query": "recentOrders" },
  "as":     { "args": ["email"], "signIn": "web" }
} } }
```

A verb is one of: `operation` (call a declared API operation, `client` to pick the service),
`query` (run a declared SQL query), or `signIn` (mint a sign-in link for an app). No code.
