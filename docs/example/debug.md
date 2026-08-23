# tour — ok (48.4s)

## What it was doing

1. ✓ `slide` One stack, one description — 5.3s · tour/01-slide.png
2. ✓ `slide` 1 · The app — 5.2s · tour/02-slide.png
3. ✓ `run` gitea.register — 4.0s · tour/03-register/debug.md
4. ✓ `frame` registered, and signed in — 49ms · tour/04-frame.png
5. ✓ `slide` 2 · The database — 5.2s · tour/05-slide.png
6. ✓ `query` accounts — 117ms · tour/06-query.png
7. ✓ `check` the account the screen just made should be a row — 17ms · tour/07-check.png
8. ✓ `query` account.byName — 74ms · tour/08-query.png
9. ✓ `check` and it should be the account we registered, not some other one — 16ms · tour/09-check.png
10. ✓ `slide` 3 · The app again — 5.2s · tour/10-slide.png
11. ✓ `run` gitea.createRepo — 874ms · tour/11-createrepo/debug.md
12. ✓ `frame` the repository, on screen — 32ms · tour/12-frame.png
13. ✓ `api` repo — 50ms · tour/13-api.png
14. ✓ `check` the screen and the API should agree that it exists — 16ms · tour/14-check.png
15. ✓ `query` repositories — 92ms · tour/15-query.png
16. ✓ `check` and so should the database underneath both — 17ms · tour/16-check.png
17. ✓ `slide` 4 · The mail — 5.2s · tour/17-slide.png
18. ✓ `run` gitea.askForAReset — 2.0s · tour/18-askforareset/debug.md
19. ✓ `run` mailpit.openInbox — 966ms · tour/19-openinbox/debug.md
20. ✓ `frame` the inbox — 32ms · tour/20-frame.png
21. ✓ `api` a second service answering — `client` says which — 25ms · tour/21-api.png
22. ✓ `check` registering an account sends a message, and this is where it lands — 16ms · tour/22-check.png
23. ✓ `slide` 5 · What watches it — 5.2s · tour/23-slide.png
24. ✓ `run` grafana.signIn — 2.6s · tour/24-signin/debug.md
25. ✓ `run` grafana.openDataSources — 755ms · tour/25-opendatasources/debug.md
26. ✓ `frame` nothing connected yet — 41ms · tour/26-frame.png
27. ✓ `slide` Four services, one run — 5.2s · tour/27-slide.png

## Network (191 requests · 2 failed)

| at | step | method | status | ms | url |
|---|---|---|---|---|---|
| 10.5s | run gitea.register | GET | 200 | 34ms | http://localhost:3020/user/sign_up |
| 14.3s | run gitea.register | POST | 303 | 29ms | http://localhost:3020/user/sign_up |
| 14.4s | run gitea.register | GET | 200 | 10ms | http://localhost:3020/ |
| 14.4s | run gitea.register | GET | 200 | 4ms | http://localhost:3020/repo/search?count_only=1&uid=1&team_id=undefined&q=&page=1&mode= |
| 14.4s | run gitea.register | GET | 200 | 10ms | http://localhost:3020/repo/search?sort=updated&order=desc&uid=1&team_id=undefined&q=&page=… |
| 25.3s | run gitea.createRepo | GET | 200 | 14ms | http://localhost:3020/repo/create |
| 26.0s | run gitea.createRepo | POST | 303 | 24ms | http://localhost:3020/repo/create |
| 26.0s | run gitea.createRepo | GET | 200 | 9ms | http://localhost:3020/witness-admin/witness-demo |
| 31.6s | run gitea.askForAReset | GET | 200 | 11ms | http://localhost:3020/user/forgot_password |
| 32.9s | run gitea.askForAReset | POST | 200 | 11ms | http://localhost:3020/user/forgot_password |
| 33.6s | run mailpit.openInbox | GET | 200 | 9ms | http://localhost:8025/ |
| 33.7s | run mailpit.openInbox | GET | 200 | 2ms | http://localhost:8025/api/v1/webui |
| 33.7s | run mailpit.openInbox | GET | 200 | 4ms | http://localhost:8025/api/v1/messages?limit=50 |
| 39.8s | run grafana.signIn | GET | 200 | 27ms | http://localhost:3010/login |
| 41.5s | run grafana.signIn | POST | 200 | 58ms | http://localhost:3010/login |
| 41.8s | run grafana.signIn | GET | 200 | 18ms | http://localhost:3010/ |
| 41.9s | run grafana.signIn | GET | 200 | 2ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 42.0s | run grafana.signIn | POST | 200 | 9ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 42.0s | run grafana.signIn | GET | 200 | 16ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 42.0s | run grafana.signIn | GET | 200 | 16ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 42.0s | run grafana.signIn | GET | 200 | 16ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 42.0s | run grafana.signIn | GET | 200 | 16ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 42.3s | run grafana.signIn | GET | 200 | 5ms | http://localhost:3010/api/user/teams |
| 42.3s | run grafana.signIn | GET | 200 | 9ms | http://localhost:3010/api/user/orgs |
| 42.3s | run grafana.signIn | GET | 200 | 11ms | http://localhost:3010/api/user/stars |
| 42.3s | run grafana.signIn | GET | 200 | 11ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 42.3s | run grafana.signIn | GET | 200 | 15ms | http://localhost:3010/apis/dashboard.grafana.app/v0alpha1/namespaces/default/search?type=f… |
| 42.3s | run grafana.signIn | GET | 200 | 46ms | https://grafana.com/blog/news.xml |
| 42.3s | run grafana.signIn | GET | 200 | 11ms | http://localhost:3010/api/alertmanager/grafana/api/v2/alerts?silenced=false&active=true&in… |
| 42.5s | run grafana.openDataSources | GET | 200 | 5ms | http://localhost:3010/connections/datasources |
| 42.5s | run grafana.openDataSources | GET | 200 | 3ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 42.5s | run grafana.openDataSources | POST | 200 | 11ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 42.5s | run grafana.openDataSources | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 42.5s | run grafana.openDataSources | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 42.5s | run grafana.openDataSources | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 42.5s | run grafana.openDataSources | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 42.9s | run grafana.openDataSources | GET | 200 | 10ms | http://localhost:3010/api/datasources |
| 42.9s | run grafana.openDataSources | GET | 200 | 10ms | http://localhost:3010/api/user/orgs |
| 42.9s | run grafana.openDataSources | GET | 200 | 14ms | http://localhost:3010/api/user/stars |
| 42.9s | run grafana.openDataSources | GET | 200 | 9ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 42.9s | run grafana.openDataSources | GET | 200 | 13ms | http://localhost:3010/api/plugins/grafana-advisor-app/settings |
| 42.9s | run grafana.openDataSources | GET | 404 | 5ms | http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storag… |
| 42.9s | run grafana.openDataSources | GET | **net::ERR_ABORTED** | 7ms | http://localhost:3010/public/build/img/icons/unicons/sort-amount-up.svg |
| 43.0s | run grafana.openDataSources | GET | 200 | 5ms | http://localhost:3010/apis/advisor.grafana.app/v0alpha1/namespaces/default/checks?labelSel… |
| 43.0s | run grafana.openDataSources | GET | 200 | 5ms | http://localhost:3010/apis/advisor.grafana.app/v0alpha1/namespaces/default/checktypes/data… |

_…and 146 static assets (scripts, styles, fonts, images) — all under 400, slowest 120ms. They are in `debug.json`._

### The ones that failed

**GET http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storag…** → 404 (5ms) during `run grafana.openDataSources`

Came back:
```
{
  "kind": "Status",
  "apiVersion": "v1",
  "metadata": {},
  "status": "Failure",
  "message": "user-storage.userstorage.grafana.app \"advisor-redirect-notice:bfw0s50xvghkwa\" not found",
  "reason": "NotFound",
  "details": {
    "name": "advisor-redirect-notice:bfw0s50xvghkwa",
    "group": "userstorage.grafana.app",
    "kind": "user-storage"
  },
  "code": 404
}
```

**GET http://localhost:3010/public/build/img/icons/unicons/sort-amount-up.svg** → net::ERR_ABORTED (7ms) during `run grafana.openDataSources`

Came back with no readable body: _response.text: Protocol error (Network.getResponseBody): No data found for resource with given identifier
Response body is not available for a response that was_

## Console (17, 2 of them errors or warnings)

- **warning** during `run grafana.signIn` — Deprecation warning: value provided is not in a recognized RFC2822 or ISO format. moment construction falls back to js Date(), which is not reliable across all browsers and versions. Non RFC2822/ISO date formats are discouraged. Please refer to http://momentjs.com/guides/#/warnings/js-date/ for more info. Arguments: [0] _isAMomentObject: true, _isUTC: false, _useUTC: false, _l: undefined, _i: Fri,… (http://localhost:3010/public/build/6029.ced17922ce65e4fd1ef9.js:620)
- **error** during `run grafana.openDataSources` — Failed to load resource: the server responded with a status of 404 (Not Found) (http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storage/advisor-redirect-notice:bfw0s50xvghkwa:0)
- debug during `run grafana.signIn` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.signIn` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.signIn` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.signIn` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-exploretraces-app}
- debug during `run grafana.signIn` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-lokiexplore-app}
- debug during `run grafana.signIn` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-metricsdrilldown-app}
- debug during `run grafana.signIn` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-pyroscope-app}
- debug during `run grafana.signIn` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.openDataSources` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.openDataSources` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-exploretraces-app}
- debug during `run grafana.openDataSources` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-lokiexplore-app}
- debug during `run grafana.openDataSources` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-metricsdrilldown-app}
- debug during `run grafana.openDataSources` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-pyroscope-app}
- debug during `run grafana.openDataSources` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.openDataSources` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-advisor-app}

## What the harness itself did

- `accounts` (101ms) → 1
- `account.byName` (54ms) → witness-admin|witness-admin@example.com|t
- `GET http://localhost:3020/api/v1/repos/witness-admin/witness-demo` → 200 (28ms) · repo
- `repositories` (68ms) → 1
- `GET http://localhost:8025/api/v1/messages` → 200 (9ms) · messages

## Where to look

- the recording: `video.mp4`
- the frames: `frames`
- everything, in the trace viewer:
  `npx playwright show-trace /Users/raunakburrows/witness/.witness/artifacts/test-results/cli-tour/trace.zip`
