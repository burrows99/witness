# grafana.signIn — ok (3.1s)

## What it was doing

1. ✓ `goto` login — 507ms · actions/grafana-signin/01-goto.png
2. ✓ `type` placeholder=email or username — 889ms · actions/grafana-signin/02-type.png
3. ✓ `type` typed, not filled: this gets recorded — 314ms · actions/grafana-signin/03-type.png
4. ✓ `click` role=button name=Log in — 84ms · actions/grafana-signin/04-click.png
5. ✓ `click` Grafana renders Skip as a button styled as a link — the frame said so — 434ms · actions/grafana-signin/05-click.png
6. ✓ `waitForUrl` localhost:3010/(\\?.*)?$ — 24ms · actions/grafana-signin/06-waitforurl.png
7. ✓ `expect` text=Welcome to Grafana — 854ms · actions/grafana-signin/07-expect.png

## Network (83 requests)

| at | step | method | status | ms | url |
|---|---|---|---|---|---|
| 5ms | goto | GET | 200 | 57ms | http://localhost:3010/login |
| 1.7s | click | POST | 200 | 58ms | http://localhost:3010/login |
| 2.1s | click | GET | 200 | 33ms | http://localhost:3010/ |
| 2.1s | click | GET | 200 | 2ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 2.2s | click | POST | 200 | 16ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 2.2s | waitForUrl | GET | 200 | 6ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 2.2s | waitForUrl | GET | 200 | 19ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 2.2s | waitForUrl | GET | 200 | 21ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 2.3s | waitForUrl | GET | 200 | 14ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 2.6s | expect | GET | 200 | 14ms | http://localhost:3010/api/user/teams |
| 2.6s | expect | GET | 200 | 15ms | http://localhost:3010/api/user/orgs |
| 2.6s | expect | GET | 200 | 32ms | http://localhost:3010/api/user/stars |
| 2.6s | expect | GET | 200 | 16ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 2.6s | expect | GET | 200 | 56ms | http://localhost:3010/apis/dashboard.grafana.app/v0alpha1/namespaces/default/search?type=f… |
| 2.6s | expect | GET | 200 | 82ms | https://grafana.com/blog/news.xml |
| 2.6s | expect | GET | 200 | 39ms | http://localhost:3010/api/alertmanager/grafana/api/v2/alerts?silenced=false&active=true&in… |

_…and 67 static assets (scripts, styles, fonts, images) — all under 400, slowest 410ms. They are in `debug.json`._

## Console (9, 1 of them errors or warnings)

- **warning** during `expect` — Deprecation warning: value provided is not in a recognized RFC2822 or ISO format. moment construction falls back to js Date(), which is not reliable across all browsers and versions. Non RFC2822/ISO date formats are discouraged. Please refer to http://momentjs.com/guides/#/warnings/js-date/ for more info. Arguments: [0] _isAMomentObject: true, _isUTC: false, _useUTC: false, _l: undefined, _i: Fri,… (http://localhost:3010/public/build/6029.ced17922ce65e4fd1ef9.js:620)
- debug during `goto` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `goto` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `waitForUrl` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `waitForUrl` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-exploretraces-app}
- debug during `waitForUrl` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-lokiexplore-app}
- debug during `waitForUrl` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-metricsdrilldown-app}
- debug during `waitForUrl` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-pyroscope-app}
- debug during `waitForUrl` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}

## Where to look

- the recording: `video.mp4`
- the frames: `frames`
- everything, in the trace viewer (when the runner records one — `use: { trace: "on" }`):
  `npx playwright show-trace /Users/raunakburrows/witness/examples/grafana/.witness/artifacts/test-results/cli-grafana-signin-then-grafana-opendashboards/trace.zip`
