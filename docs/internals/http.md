# http

`src/http/` — asking the running system a question.

| file | |
|---|---|
| `client.ts` (113) | a base URL, auth, JSON in and out, and an error that names the request |
| `operations.ts` (141) | one API as a named set of operations |

`client.ts` is deliberately thin. Everything above it — routes, DTOs, the vocabulary of a product —
is config, not code.

Every request the system can make is **declared**, so "what can this thing do" is answerable by
reading one file, and the same list drives the command line and the `api` step. Nothing hand-builds
a URL.

The wire format (`rest`, `graphql`) and the auth scheme are [providers](providers.md); an operation
names which auth it needs, so a config can say "this route needs the service key, that one needs the
member's session" without either being a default.

Every call goes through the [trace](diagnostics.md) with its body, timing and response — an agent
gets the exchange back rather than a number.
