# Providers

Everything the harness does against the outside world is a **named provider** the config picks by
name. Adding a second way of doing any of it means registering one more implementation, not editing
the harness. A wrong name says what *is* registered, rather than a stack trace about `undefined`.

## client — how an API is spoken to

| name | |
|---|---|
| `rest` | path + method + JSON body (default) |
| `graphql` | one endpoint, `query`/`variables` — and a failure is a 200 with `errors[]`, which it declares for itself |

A provider may say what failure looks like in a *body*, where its format defines one: the debug story
reads that so a GraphQL error shows up in the network table rather than as an unremarkable `200`. A
client's own [`failureWhen`](config.md#api) wins over it — a product knows its API better than its
wire format does.

## auth — how a request is authenticated

| name | shape |
|---|---|
| `apiKey` | `{ provider, header, from }` |
| `bearer` | `{ provider, from }` |
| `basic` | `{ provider, user, from }` |
| `cookie` | `{ provider, name }` — from a run param |
| `login` | `{ provider, operation, … }` — call something first, use what comes back |

`from` is a **secret source**, so a credential is never spelled out in the file.

## secret — where a credential comes from

| name | reads |
|---|---|
| `containerEnv` | an environment variable **inside the container** — the usual one; inside a service, `{ "containerEnv": "KEY" }` is enough |
| `envFile` | the compose `.env` |
| `env` | this process's environment |
| `secret` | another declared secret |
| `literal` | a value written down — for a throwaway local stack only |

## recorder — what captures a service while it runs

| name | tool |
|---|---|
| *(none)* | a browser, driven by the harness — the default, and needs no name |
| `terminal` | VHS, for a service with no screen |

## video — how captures become one watchable file

| name | tool |
|---|---|
| `ffmpeg` | stitching, panels, splicing slide cards |

A recorder and a video provider are the two ends of one pipeline, not alternatives:
[explanation/recorder-vs-video.md](../explanation/recorder-vs-video.md).

## stub — local stand-ins for third parties

| name | |
|---|---|
| `http` | declared routes and canned responses, on a port |

For the thing that charges a card, sends the mail or dispatches a person — which a run must not
actually do.
