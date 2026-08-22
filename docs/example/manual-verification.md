# What a fresh Grafana is — manual verification (run)

Run: `grafana-thewholeproduct` (cli)

Whether what this run made is still there depends on what it did — nothing here removes it. `KEEP=1` asks anything that cleans up to leave it alone.

## Who

- instance: `http://localhost:3010`
- dashboards: `0`
- users: `1`

## Sign in as them

```bash
docker run -d --name witness-example-grafana -p 3010:3000 grafana/grafana
open http://localhost:3010 — admin / admin
```

## Where to look

- Grafana: http://localhost:3010
- sign in with the cast's admin account

## What the run saw

- The API reported 0 dashboards, 0 data sources and 1 user.
- Dashboards, Explore, Connections, Users and Profile were each opened and photographed.
- The catalogue offered 8 matches for "prometheus" — see the frame.
- Nothing was saved: the new dashboard was opened and abandoned.
