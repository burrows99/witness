# Recorder and video are two ends of one pipeline

They sound like alternatives. They are stages.

```
   the service runs   →   RECORDER captures it   →   VIDEO makes it watchable
                          browser | terminal          ffmpeg
```

A **recorder** is pointed at a service *while it runs* and produces raw captures. A **video
provider** takes whatever was captured and produces one file: stitching panes into a grid, splicing
in slide cards, muxing to MP4.

They are separate because neither can do the other's job. ffmpeg cannot drive a browser or type into
a shell. VHS cannot stitch four panes and splice a title card. And the pairing is many-to-one — a
browser pane and a terminal pane both feed the same stitcher.

## Where each is declared

**Recorder** is per **service**, because it is a fact about that service: a queue worker has no
screen, and that is true of the worker, not of the run.

```jsonc
"services": { "worker": { "records": "terminal", "shell": "docker exec -it … bash" } }
```

Omit it and the harness drives a browser. That is the default and needs no name — the alternative
was making every ordinary service write `"records": "browser"` to say nothing.

**Video** is per **config**, because there is one output file.

```jsonc
"video": { "provider": "ffmpeg" }
```

## Why a terminal recording composes

The terminal recorder emits the same shape a browser pane does, so a shell sits **beside** a screen
in one `--parallel` frame — somebody registering in the app on the left, the row appearing in the
database on the right. That is the reason for the split doing any work: without it, "record the CLI
service" would have meant a second, parallel pipeline that could never share a frame with the first.

Two honest asymmetries remain. A terminal pane cannot be handed a header the way a page can, so its
tape types its own name first. And a `click` step has no meaning without a screen, so the translation
skips it — a recording that invented an interaction would be worse than one missing it.
