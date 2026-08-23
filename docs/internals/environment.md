# environment

`src/environment/` — where the running thing actually is.

| file | |
|---|---|
| `stack.ts` (190) | service → URL, port, container, and whether it is up |
| `docker.ts` (71) | the containers, over the docker CLI |
| `workspace.ts` (130) | `.witness/` — the one directory this tool reads and writes |

## stack

The one thing every other part needs and the one thing that differs between checkouts. A stack is
described twice — once to `docker compose`, once to whatever drives it — and when those are written
separately they drift, so this reads the **same `.env` compose reads**. `portVar` names the variable;
a literal port anywhere else is that knob quietly disconnected.

`suffixVar` (default `WT`) appends the worktree suffix to container names, so a second checkout gets
its own containers without a wrapper script.

`probe` decides "up". The object form (`path`, `status`, `contains`) is what separates *something is
listening* from *our thing is listening* when two projects share a machine.

`status` answers in three states, not two. `probe: "container"` with no container to ask about means
**cannot tell** (`reachable: undefined`, printed as `?`) — answering DOWN there is indistinguishable
from a service that really is down, on the one board whose whole job is being believed.

## docker

Shells out to the docker CLI rather than talking to the daemon: this runs beside `docker compose`,
and the CLI is the one interface that is always present and always agrees with what compose just did.

## workspace

`.witness/`, for the reason `.github/`, `.claude/` and `.vscode/` exist: one well-known name means
nothing has to be configured before anything works. The directory also names its own checkout — the
parent — which is why a config kept there needs no `root` markers.
