# theApp — ok (11.9s)

## What it was doing

1. ✓ `slide` Four services, at once — 5.2s · theapp/01-slide.png
2. ✓ `run` gitea.register — 3.9s · theapp/02-register/debug.md
3. ✓ `run` gitea.createRepo — 846ms · theapp/03-createrepo/debug.md
4. ✓ `run` gitea.askForAReset — 1.9s · theapp/04-askforareset/debug.md
5. ✓ `frame` the repository, on screen — 32ms · theapp/05-frame.png

## Network (52 requests)

| at | step | method | status | ms | url |
|---|---|---|---|---|---|
| 5.2s | run gitea.register | GET | 200 | 10ms | http://localhost:3020/user/sign_up |
| 9.0s | run gitea.register | POST | 303 | 20ms | http://localhost:3020/user/sign_up |
| 9.0s | run gitea.register | GET | 200 | 8ms | http://localhost:3020/ |
| 9.0s | run gitea.register | GET | 200 | 2ms | http://localhost:3020/repo/search?count_only=1&uid=1&team_id=undefined&q=&page=1&mode= |
| 9.0s | run gitea.register | GET | 200 | 5ms | http://localhost:3020/repo/search?sort=updated&order=desc&uid=1&team_id=undefined&q=&page=… |
| 9.2s | run gitea.createRepo | GET | 200 | 4ms | http://localhost:3020/repo/create |
| 9.8s | run gitea.createRepo | POST | 303 | 20ms | http://localhost:3020/repo/create |
| 9.9s | run gitea.createRepo | GET | 200 | 7ms | http://localhost:3020/witness-admin/witness-demo |
| 10.0s | run gitea.askForAReset | GET | 200 | 3ms | http://localhost:3020/user/forgot_password |
| 11.3s | run gitea.askForAReset | POST | 200 | 6ms | http://localhost:3020/user/forgot_password |

_…and 42 static assets (scripts, styles, fonts, images) — all under 400, slowest 46ms. They are in `debug.json`._

## Where to look

- the recording: `video.mp4`
- the frames: `frames`
- everything, in the trace viewer:
  `npx playwright show-trace /Users/raunakburrows/witness/.witness/artifacts/test-results/cli-theapp-then-theoutsider-then-themail-then-thewatcher/trace.zip`
