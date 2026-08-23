# system

`src/system.ts` (478 lines) — the composite root.

There is nothing to subclass and no base class to extend. Everything that differs between products —
services, operations, queries, routes, sign-in, the command line — is data read from one file. Point
it at a different config and it drives a different product.

## What it assembles

| getter | from | present when |
|---|---|---|
| `stack` | `services` | always |
| `api` / `client(name)` | a service's `api` | `hasApi` |
| `db` | a service's `database` | `hasDatabase` |
| `apps` | a service's `app` | |
| `actions` | `actions`, everywhere | |
| `evidence`, `trace` | | always |
| `cli` | [commandsFor](cli.md) | always |

Everything is lazy. A config with no database builds a system with no database, and `db sql` is not
offered rather than failing when used.

## What lives here and what does not

Here: knowing which parts a description implies, and wiring them to each other.

Not here: what the command line looks like (`cli/commands.ts`), or how drift is swept
(`diagnostics/drift.ts`). Both were methods on this class; both were about something else. The class
was 599 lines, of which 132 were a command line.

The test to apply: does it add knowledge, or read what the system already knows? Only the first
belongs on the root.
