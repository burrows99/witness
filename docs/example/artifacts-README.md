# What this run left behind

One browser session, so one recording and one set of named stills — both at this level.
Below them, a directory per action, and **an action a step composed sits inside that step**,
named for it. The directory tree is the call tree.

- `video.mp4` — the whole session, watchable
- `frames/` — the stills a `frame` step asked for, in order
- `manual-verification.md` — how to re-walk this by hand
- `<action>/NN-<verb>.png` — a frame per step, numbered as they happened
- `<action>/debug.md` — what happened, with the network and console tied to each step

## What ran what

```
tour  (21 frames)
  03-register  (9 frames)
  11-createrepo  (6 frames)
  18-askforareset  (4 frames)
  19-openinbox  (3 frames)
  24-signin  (7 frames)
  25-opendatasources  (3 frames)
```
