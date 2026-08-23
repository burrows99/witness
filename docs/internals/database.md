# database

`src/database/` — reading what was *stored*.

| file | |
|---|---|
| `postgres.ts` (63) | the stack's database, over the docker CLI |
| `queries.ts` (45) | the database as a named set of queries |

Out of band is the point. The screen is evidence of what the app **rendered**; the API of what it
**answered**; neither is evidence of what was **stored**. A `check` comparing a `query` result to
what the screen shows is a claim no single layer can make.

Named queries, in the config, for the same reason operations are named: one readable list of what we
assert, rather than SQL strings scattered through step lists. It also makes the dangerous half
obvious — anything that writes is right there to be seen.

Not a shortcut around the app. Seeding a precondition no endpoint can create is legitimate; asserting
a row instead of driving the flow that should have written it is how a green run stops meaning
anything.
