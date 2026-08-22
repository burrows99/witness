# The Grafana example

Somebody else's software, described for witness in about sixty lines, driven from a shell, and recorded.
Nothing here is Grafana-specific machinery — it is the same vocabulary any product is described in.

```bash
docker run -d --name witness-example-grafana -p 3010:3000 grafana/grafana
cd examples/grafana
npx witness stack status
npx witness api get /api/health
npx witness action run grafana.signIn grafana.openDashboards username=admin password=admin
```

The last command opens a browser, drives both actions in one session, and leaves a frame per step, a
`debug.md` story, and an MP4 under `.witness/artifacts/` — which is gitignored, because evidence belongs
to the run that made it. A copy of one run lives in [`../../docs/example/`](../../docs/example) so the
README has something to show.

Everything the tool knows about Grafana is in [`.witness/config.jsonc`](.witness/config.jsonc). Two lines
of it are there because a run told me so — `Skip` is a button that looks like a link, and the home page's
heading changes with the time of day — both found by looking at the frame from the step that failed.

Tear it down with `docker rm -f witness-example-grafana`.
