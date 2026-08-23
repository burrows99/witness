# Record a service with no screen

Every stack has one — a migration, a queue worker, the `psql` somebody actually types. Playwright is
the wrong tool for filming it.

```jsonc
"shell": {
  "container": "witness-postgres",
  "records": "terminal",
  "shell": "docker exec -it witness-postgres bash",
  "actions": {
    "readTheDatabase": {
      "summary": "the database, from a prompt, the way a person actually looks",
      "steps": [
        { "caption": { "text": "what the app wrote, from a shell" } },
        { "type": { "on": "prompt", "value": "psql -U gitea -d gitea -c 'select name from \"user\"'" } },
        { "press": "Enter" },
        { "wait": 1800 }
      ]
    }
  }
}
```

Needs `vhs` on the path (`brew install vhs`). Without it the run says so in `warnings` and carries on,
the same way ffmpeg is treated.

## What translates, and what does not

| step | tape |
|---|---|
| `type` | `Type "…"` |
| `press: "Enter"` | `Enter` |
| `wait: 1800` | `Sleep 1800ms` |
| `expect: { text }` | `Wait+Screen /…/` — the same claim a screen makes |
| `caption` | a shell comment, typed |
| `click` | **skipped** — it means nothing without a screen, and a recording that invented an interaction would be worse than one missing it |

## Why it stitches

The recording comes out the same shape as a browser pane, so a shell sits **beside** a screen in one
`--parallel` frame:

```bash
npx witness action run theWatcher shell.readTheDatabase theMail --parallel
```

A terminal pane cannot be handed a header the way a page can, so the tape types its own name first.

## Two stages, easily confused

A **recorder** captures a service while it runs. **video** turns whatever was captured into one file.
`ffmpeg` cannot drive a browser; `vhs` cannot stitch panes. See
[explanation/recorder-vs-video.md](../explanation/recorder-vs-video.md).
