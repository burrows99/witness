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

## Make the pane fit what you are showing

The default is 1280x900 at 20pt — about thirty rows, and fewer as soon as anything wraps. A command
whose output is longer than that ends the recording showing its **tail**, and a headline printed
first is nowhere: the output arrives in one write, so there is no intermediate frame to fall back on.

```jsonc
"pane": { "height": 1350, "fontSize": 14 }
```

On the service, or on one action when only that one needs it. Raise the pane rather than piping the
command through `head -N`: the pipe truncates the thing being demonstrated to fit the thing filming
it, and leaves a statement about pane geometry inside a description where nobody will connect the two.

The default is matched to a browser pane so the two stitch together in one `--parallel` frame without
either being letterboxed — so change it for a pane that is recorded on its own.

## Look at what it recorded

A run leaves the video and, beside it, its **last frame**:

```
.witness/artifacts/cli/<action>/<cut>/
  video.mp4
  video.png     the last frame — the one a shell's output is on
```

A Read on an MP4 returns no pixels, which left `/flow` phase 5 — *open the frames* — with nothing to
open for the half of this tool that has no screen. The still is the last frame rather than the first
for the same reason the pane has to be big enough: with a shell, the claim is on the final screen.

## What translates, and what does not

| step | tape |
|---|---|
| `type` | `Type "…"` |
| `press: "Enter"` | `Enter` |
| `wait: 1800` | `Sleep 1800ms` |
| `expect: { text }` | `Wait+Screen /…/` — the same claim a screen makes |
| `caption` | a shell comment, typed |
| `click` | **skipped** — it means nothing without a screen, and a recording that invented an interaction would be worse than one missing it |

A `type` reaches the shell **exactly** as written — backslashes, quotes and all. A tape has no escapes
inside a `Type` string, so the quote character moves to one the text does not use rather than anything
being escaped into it; text that uses all three is refused, because a recorder that silently alters
what it records is worse than one that stops. `tr '\n' ' '` once arrived as `tr '\\n' ' '`, which maps
every `n` to a space — with a valid tape, an exit code of 0, and nothing to see but the pixels.

Braces are the other half: `{name}` is a parameter, and `{{…}}` is text
([steps.md](../reference/steps.md#gathering)), which is what lets `--format '{{.Names}}'` be a step.

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
