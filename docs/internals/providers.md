# providers

`src/providers/` — every named way of touching the outside world.

| file | registry | registered |
|---|---|---|
| `registry.ts` (40) | — | the registry itself |
| `clients.ts` (233) | `client` | `rest`, `graphql` |
| `auth.ts` (134) | `auth` | `apiKey`, `bearer`, `basic`, `cookie`, `login` |
| `secrets.ts` (70) | `secret` | `containerEnv`, `secret`, `envFile`, `env`, `literal` |
| `recorders.ts` (125) | `recorder` | `terminal` |
| `video.ts` (245) | `video` | `ffmpeg` |
| `stubs.ts` (271) | `stub` | `http` |

The point is not indirection for its own sake: adding a second way of doing any of these means
registering one more implementation, not editing the system. A wrong name throws a sentence listing
what *is* registered — the alternative is a stack trace about `undefined`.

The registries are also what the [config template](config.md) asks for its provider lists, so a new
provider documents itself.

## clients

REST and GraphQL differ in exactly two ways — where the operation's identity lives (a path vs a
document) and how the answer is shaped — so they are two providers over one client, not two clients.

## secrets

Never the config file itself. The config says *where to look*; a provider looks. `containerEnv` is
the usual one, and inside a service `{ "containerEnv": "KEY" }` is the whole declaration.

## recorders and video

Two ends of one pipeline, not alternatives — see
[explanation/recorder-vs-video.md](../explanation/recorder-vs-video.md). `asTape()` translates steps
into a VHS tape; `click` is deliberately skipped, because a recording that invented an interaction
would be worse than one missing it.

A missing `ffmpeg` or `vhs` is a **warning**, never a failure. A transcode problem must not fail a run
that otherwise did its job.

## stubs

Browser-level interception cannot help: these requests leave the app's own process, so the only place
to answer them is a real server on a real port the app is pointed at. And they must be answered —
the alternative is a run that really charges a card, sends the mail, or dispatches a person.
