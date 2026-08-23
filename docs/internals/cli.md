# cli

`src/cli/` — `<tool> <noun> <verb> [args]`.

| file | |
|---|---|
| `cli.ts` (233) | the git-style shell: nouns, verbs, help, exit codes, JSON out |
| `commands.ts` (138) | the command line one description gives you |

## Why a harness needs one

Everything it can do to a running app — sign someone in, ask the API a question, read a row, drive a
sequence — is useful **outside** a run. Without a command line an agent has to write a program to ask
one question.

## The split

`commands.ts` is not a method on `System` because assembling a product's parts and deciding what a
command line looks like are two jobs. Everything in it reads what the system already knows and adds
no knowledge of its own — which is exactly why it can live outside the class that holds it.

## Conventions

- results to **stdout as JSON**, progress and warnings to **stderr**, so `| jq` works
- exit `0` fine, `1` a real failure (a failed action, drift found), `2` usage
- `check drift` sets `process.exitCode` rather than exiting, so the report flushes first
- a verb marked `raw` prints its own output — the drift report *is* the answer, not a record of a
  request nobody made
- config-declared nouns and code-added ones **merge** rather than replacing: a noun usually comes
  from the config, and code adds the one verb that needed code
- flags are parsed separately and passed to the verb: `run(args, flags)`. They used to be stripped
  before the verb saw them, which is how `--parallel` silently did nothing
