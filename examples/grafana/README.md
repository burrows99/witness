# The Grafana example

Somebody else's software, described for witness in about sixty lines, driven from a shell, and recorded.
Nothing here is Grafana-specific machinery — it is the same vocabulary any product is described in.

```bash
cd examples/grafana
docker compose up -d
npx witness stack status
npx witness api get /api/health
npx witness action run grafana.theWholeProduct
```

**No arguments and no environment variables.** The credentials are declared in
[`.witness/config.jsonc`](.witness/config.jsonc) as `containerEnv` and read back out of the *running*
container that `docker-compose.yml` created — which is the provider to prefer for anything real: a
container keeps the values it was created with, so a file on disk and the process serving requests can
disagree, and the process is the one telling the truth.

The last command opens a browser, walks the whole product in one session — narrated, and checked against
Grafana's own API as it goes — and leaves a frame per step, named stills, a `debug.md` story, a
`manual-verification.md`, a Playwright trace and an MP4 under `.witness/artifacts/`, which is gitignored
because evidence belongs to the run that made it. A copy of one run lives in
[`../../docs/example/`](../../docs/example) so the README has something to show.

Four lines of the description are what they are because a run told me so — `Skip` is a button that looks
like a link, the home page's heading changes with the time of day, the plugin search placeholder is
"Search Grafana plugins", and the empty dashboard says "Add a panel to visualize your data" in 13.2.
Every one was found by opening the frame from the step that failed.

```bash
docker compose down          # and `-v` to forget the instance entirely
```
