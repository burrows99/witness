# What this run left behind

One browser session, so one recording and one set of named stills — both at this level.
Below them, a directory per action, and **an action a step composed sits inside that step**,
named for it. The directory tree is the call tree.

- `video.mp4` — the whole session, watchable
- `frames/` — the stills a `frame` step asked for, in order
- `<action>/NN-<verb>.png` — a frame per step, numbered as they happened
- `<action>/debug.md` — what happened, with the network and console tied to each step

## What ran what

```
theapp  (2 frames)
  02-register  (9 frames)
  03-createrepo  (5 frames)
  04-askforareset  (4 frames)
themail  (6 frames)
  01-openinbox  (3 frames)
theoutsider  (3 frames)
  01-explore  (2 frames)
  03-explore  (2 frames)
  05-explore  (2 frames)
thewatcher  (1 frame)
  01-signin  (7 frames)
  02-opendatasources  (3 frames)
```
