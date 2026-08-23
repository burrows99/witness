# The directory tree is the call tree

Playwright's own answer is deliberate and documented: `outputDir` is flat, opaquely named, and
cleaned at the start of each run; structure lives in the trace viewer and the HTML report. For a
person that is the better design — the viewer shows a timeline, a DOM snapshot and the network in one
place, which no filesystem can.

It is the wrong design when the reader is not a person.

An agent reading a failing run does not open a trace viewer. It lists a directory. So the structure
has to be *in* the directory: an action a step composed sits **inside that step**, named for it.

```
theapp/
  01-slide.png
  02-run/                    ← the step
    signin/                  ← what it ran
      01-goto.png
      debug.md
  03-click.png
  debug.md
```

`ls` answers "what ran what". `README.md` at the root prints the same tree, read back off the
directories that produced it.

## What this costs

**It has to explain itself.** One browser session means one recording, at the top. A directory below
it with no `video.mp4` reads as one being missing — which is exactly how this layout was first
reported as a bug. Hence the README, and hence this page.

**Clearing is subtle.** "Empty the directory at the start" plus "compose actions write into each
other's directories" quietly deleted evidence mid-run: a composed action wrote its frames, then the
parent cleared the tree above it, and `debug.md` pointed at a directory that no longer existed. The
run is now cleared **once**, on the first write of the process, rather than once per action.

**Names must be stable and unique.** Slugs are derived from what was run — never typed — because
hand-named evidence does not survive a repository: two runs shorten to the same slug and write into
one bundle, and a failed run's frames end up under a passing one's name.

## The trace is still there

`trace.zip` is kept, and the debug story names its path. When a person wants the timeline,
`npx playwright show-trace …` gives them the better tool. The filesystem layout is for the reader who
cannot open it.
