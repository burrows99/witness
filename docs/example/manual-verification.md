# The whole stack, walked once — manual verification (run)

Run: `tour` (cli)

Whether what this run made is still there depends on what it did — nothing here removes it. `KEEP=1` asks anything that cleans up to leave it alone.

## Who

- app: `http://localhost:3020`
- mail: `http://localhost:8025`
- watching: `http://localhost:3010`
- account: `witness-admin`

## Sign in as them

```bash
docker compose up -d
open http://localhost:3020 — witness-admin
```

## Where to look


## What the run saw

- Registered witness-admin through the web UI; Gitea made it an administrator.
- Postgres held 1 account and 1 repository afterwards.
- Gitea's own API agreed the repository exists: witness-admin/witness-demo.
- The mail it sent was caught by Mailpit rather than delivered.
- Nothing here was seeded by hand: every row was made through the product.
