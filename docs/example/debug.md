# grafana.theWholeProduct — ok (32.8s)

## What it was doing

1. ✓ `slide` Grafana, described — 5.3s · actions/grafana-thewholeproduct/01-slide.png
2. ✓ `run` grafana.signIn — 3.0s · actions/grafana-thewholeproduct/02-run.png
3. ✓ `frame` signed in — 73ms · actions/grafana-thewholeproduct/03-frame.png
4. ✓ `api` what the instance says about itself, before looking at a single screen — 52ms · actions/grafana-thewholeproduct/04-api.png
5. ✓ `slide` What it says it holds — 5.3s · actions/grafana-thewholeproduct/05-slide.png
6. ✓ `run` grafana.openDashboards — 782ms · actions/grafana-thewholeproduct/06-run.png
7. ✓ `frame` dashboards, empty — 34ms · actions/grafana-thewholeproduct/07-frame.png
8. ✓ `api` search — 34ms · actions/grafana-thewholeproduct/08-api.png
9. ✓ `check` the API and the screen should agree about how many dashboards there are — 25ms · actions/grafana-thewholeproduct/09-check.png
10. ✓ `run` grafana.startADashboard — 1.2s · actions/grafana-thewholeproduct/10-run.png
11. ✓ `frame` a new dashboard, unsaved — 66ms · actions/grafana-thewholeproduct/11-frame.png
12. ✓ `slide` Nothing to query yet — 5.2s · actions/grafana-thewholeproduct/12-slide.png
13. ✓ `run` grafana.openExplore — 1.2s · actions/grafana-thewholeproduct/13-run.png
14. ✓ `frame` explore — 49ms · actions/grafana-thewholeproduct/14-frame.png
15. ✓ `run` grafana.openDataSources — 902ms · actions/grafana-thewholeproduct/15-run.png
16. ✓ `frame` no data sources — 45ms · actions/grafana-thewholeproduct/16-frame.png
17. ✓ `caption` What it could connect to — 35ms · actions/grafana-thewholeproduct/17-caption.png
18. ✓ `run` grafana.browseConnections — 2.4s · actions/grafana-thewholeproduct/18-run.png
19. ✓ `check` searching the catalogue for prometheus should offer something — 24ms · actions/grafana-thewholeproduct/19-check.png
20. ✓ `frame` the connection catalogue — 52ms · actions/grafana-thewholeproduct/20-frame.png
21. ✓ `slide` Who can get in — 5.2s · actions/grafana-thewholeproduct/21-slide.png
22. ✓ `run` grafana.openUsers — 779ms · actions/grafana-thewholeproduct/22-run.png
23. ✓ `frame` one account — 59ms · actions/grafana-thewholeproduct/23-frame.png
24. ✓ `check` the user table should hold the accounts the API counted — 24ms · actions/grafana-thewholeproduct/24-check.png
25. ✓ `run` grafana.openProfile — 866ms · actions/grafana-thewholeproduct/25-run.png
26. ✓ `frame` the admin's own page — 41ms · actions/grafana-thewholeproduct/26-frame.png

## Network (500 requests · 4 failed · 31 over a second)

_173 more were not recorded: the run passed the limit._

| at | step | method | status | ms | url |
|---|---|---|---|---|---|
| 5.3s | run grafana.signIn | GET | 200 | 71ms | http://localhost:3010/login |
| 7.2s | run grafana.signIn | POST | 200 | 74ms | http://localhost:3010/login |
| 7.5s | run grafana.signIn | GET | 200 | 43ms | http://localhost:3010/ |
| 7.7s | run grafana.signIn | GET | 200 | 1ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 7.7s | run grafana.signIn | POST | 200 | 19ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 7.8s | run grafana.signIn | GET | 200 | 19ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 7.8s | run grafana.signIn | GET | 200 | 18ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 7.8s | run grafana.signIn | GET | 200 | 17ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 7.8s | run grafana.signIn | GET | 200 | 17ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 8.1s | run grafana.signIn | GET | 200 | 17ms | http://localhost:3010/api/user/teams |
| 8.1s | run grafana.signIn | GET | 200 | 18ms | http://localhost:3010/api/user/orgs |
| 8.1s | run grafana.signIn | GET | 200 | 19ms | http://localhost:3010/api/user/stars |
| 8.1s | run grafana.signIn | GET | 200 | 16ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 8.1s | run grafana.signIn | GET | 200 | 42ms | http://localhost:3010/apis/dashboard.grafana.app/v0alpha1/namespaces/default/search?type=f… |
| 8.1s | run grafana.signIn | GET | 200 | 96ms | https://grafana.com/blog/news.xml |
| 8.2s | run grafana.signIn | GET | 200 | 34ms | http://localhost:3010/api/alertmanager/grafana/api/v2/alerts?silenced=false&active=true&in… |
| 13.7s | run grafana.openDashboards | GET | 200 | 16ms | http://localhost:3010/dashboards |
| 13.8s | run grafana.openDashboards | GET | 200 | 1ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 13.9s | run grafana.openDashboards | POST | 200 | 30ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 13.9s | run grafana.openDashboards | GET | 200 | 16ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 13.9s | run grafana.openDashboards | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 13.9s | run grafana.openDashboards | GET | 200 | 20ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 13.9s | run grafana.openDashboards | GET | 200 | 20ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 14.0s | run grafana.openDashboards | GET | 200 | 5ms | http://localhost:3010/apis/dashboard.grafana.app/v0alpha1/namespaces/default/search?type=f… |
| 14.3s | run grafana.openDashboards | GET | 200 | 17ms | http://localhost:3010/api/folders?page=1&limit=50 |
| 14.3s | run grafana.openDashboards | GET | 200 | 17ms | http://localhost:3010/api/user/orgs |
| 14.3s | run grafana.openDashboards | GET | 200 | 33ms | http://localhost:3010/apis/provisioning.grafana.app/v0alpha1/namespaces/default/settings |
| 14.3s | run grafana.openDashboards | GET | 200 | 34ms | http://localhost:3010/api/folders/general?accesscontrol=true&isLegacyCall=false |
| 14.3s | run grafana.openDashboards | GET | 200 | 21ms | http://localhost:3010/apis/quotas.grafana.app/v0alpha1/namespaces/default/usage?group=dash… |
| 14.3s | run grafana.openDashboards | GET | 200 | 20ms | http://localhost:3010/apis/quotas.grafana.app/v0alpha1/namespaces/default/usage?group=fold… |
| 14.3s | run grafana.openDashboards | GET | 200 | 33ms | http://localhost:3010/api/teams/search?perpage=200&sort=name-asc |
| 14.3s | run grafana.openDashboards | GET | 200 | 26ms | http://localhost:3010/api/user/stars |
| 14.3s | run grafana.openDashboards | GET | 200 | 25ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 14.3s | run grafana.openDashboards | GET | **net::ERR_ABORTED** | 31ms | http://localhost:3010/public/build/img/icons/unicons/spinner.svg |
| 14.3s | run grafana.openDashboards | GET | 200 | 20ms | http://localhost:3010/apis/dashboard.grafana.app/v0alpha1/namespaces/default/search?query=… |
| 14.6s | run grafana.startADashboard | GET | 200 | 15ms | http://localhost:3010/dashboard/new |
| 14.7s | run grafana.startADashboard | GET | 200 | 2ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 14.7s | run grafana.startADashboard | POST | 200 | 13ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 14.8s | run grafana.startADashboard | GET | 200 | 2ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 14.8s | run grafana.startADashboard | GET | 200 | 15ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 14.8s | run grafana.startADashboard | GET | 200 | 21ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 14.8s | run grafana.startADashboard | GET | 200 | 20ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 15.1s | run grafana.startADashboard | GET | 200 | 3ms | http://localhost:3010/apis/dashboard.grafana.app/ |
| 15.1s | run grafana.startADashboard | GET | 200 | 3ms | http://localhost:3010/api/user/orgs |
| 15.1s | run grafana.startADashboard | GET | 200 | 15ms | http://localhost:3010/api/user/stars |
| 15.1s | run grafana.startADashboard | GET | 200 | 7ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 15.1s | run grafana.startADashboard | GET | **net::ERR_ABORTED** | 48ms | http://localhost:3010/public/build/img/icons/unicons/spinner.svg |
| 21.0s | run grafana.openExplore | GET | 200 | 91ms | http://localhost:3010/explore |
| 21.2s | run grafana.openExplore | GET | 200 | 1ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 21.3s | run grafana.openExplore | POST | 200 | 12ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 21.3s | run grafana.openExplore | GET | 200 | 17ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 21.3s | run grafana.openExplore | GET | 200 | 17ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 21.3s | run grafana.openExplore | GET | 200 | 17ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 21.3s | run grafana.openExplore | GET | 200 | 16ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 21.7s | run grafana.openExplore | GET | 200 | 2ms | http://localhost:3010/api/user/orgs |
| 21.7s | run grafana.openExplore | GET | 200 | 32ms | http://localhost:3010/api/user/stars |
| 21.7s | run grafana.openExplore | GET | 200 | 31ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 21.7s | run grafana.openExplore | GET | 200 | 6ms | http://localhost:3010/api/datasources/correlations?sourceUID=grafana |
| 21.7s | run grafana.openExplore | GET | 200 | 70ms | http://localhost:3010/api/live/list |
| 21.7s | run grafana.openExplore | GET | **net::ERR_ABORTED** | 58ms | http://localhost:3010/public/build/img/icons/unicons/ellipsis-v.svg |
| 21.8s | run grafana.openExplore | POST | 200 | 16ms | http://localhost:3010/api/query-history |
| 22.3s | run grafana.openDataSources | GET | 200 | 14ms | http://localhost:3010/connections/datasources |
| 22.4s | run grafana.openDataSources | GET | 200 | 1ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 22.5s | run grafana.openDataSources | POST | 200 | 10ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 22.5s | run grafana.openDataSources | GET | 200 | 14ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 22.5s | run grafana.openDataSources | GET | 200 | 13ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 22.5s | run grafana.openDataSources | GET | 200 | 13ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 22.5s | run grafana.openDataSources | GET | 200 | 13ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 22.8s | run grafana.openDataSources | GET | 200 | 10ms | http://localhost:3010/api/datasources |
| 22.8s | run grafana.openDataSources | GET | 200 | 10ms | http://localhost:3010/api/user/orgs |
| 22.8s | run grafana.openDataSources | GET | 200 | 27ms | http://localhost:3010/api/user/stars |
| 22.8s | run grafana.openDataSources | GET | 200 | 14ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 22.8s | run grafana.openDataSources | GET | 200 | 15ms | http://localhost:3010/api/plugins/grafana-advisor-app/settings |
| 22.9s | run grafana.openDataSources | GET | 404 | 22ms | http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storag… |
| 22.9s | run grafana.openDataSources | GET | 200 | 11ms | http://localhost:3010/apis/advisor.grafana.app/v0alpha1/namespaces/default/checks?labelSel… |
| 22.9s | run grafana.openDataSources | GET | 200 | 10ms | http://localhost:3010/apis/advisor.grafana.app/v0alpha1/namespaces/default/checktypes/data… |
| 23.3s | run grafana.browseConnections | GET | 200 | 8ms | http://localhost:3010/connections/add-new-connection |
| 23.4s | run grafana.browseConnections | GET | 200 | 1ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 23.4s | run grafana.browseConnections | POST | 200 | 15ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 23.4s | run grafana.browseConnections | GET | 200 | 22ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 23.4s | run grafana.browseConnections | GET | 200 | 22ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 23.4s | run grafana.browseConnections | GET | 200 | 16ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 23.4s | run grafana.browseConnections | GET | 200 | 17ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 23.8s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/plugins/errors |
| 23.8s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/plugins?embedded=include-datasource&accesscontrol=true |
| 23.8s | run grafana.browseConnections | GET | 200 | 254ms | http://localhost:3010/api/gnet/plugins?includeDeprecated=true |
| 23.8s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/plugins/errors |
| 23.8s | run grafana.browseConnections | GET | 200 | 3ms | http://localhost:3010/api/plugins?embedded=include-datasource&accesscontrol=true |
| 23.8s | run grafana.browseConnections | GET | 200 | 498ms | http://localhost:3010/api/gnet/plugins?includeDeprecated=true |
| 23.8s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/user/orgs |
| 23.8s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/user/stars |
| 23.8s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.0s | http://localhost:3010/api/gnet/plugins/optimiz-sevone-datasource/versions/1.0.2/logos/smal… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.0s | http://localhost:3010/api/gnet/plugins/oci-logs-datasource/versions/5.0.4/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.0s | http://localhost:3010/api/gnet/plugins/oci-metrics-datasource/versions/6.5.6/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/grafana-oracle-datasource/versions/3.5.1/logos/smal… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/gridprotectionalliance-osisoftpi-datasource/version… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/grafana-pagerduty-datasource/versions/1.2.16/logos/… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/tobiasworkstech-parquets3-datasource/versions/1.2.1… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/parseable-parseable-datasource/versions/2.0.0/logos… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/pixie-pixie-datasource/versions/0.0.9/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/sni-pnp-datasource/versions/2.2.2/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/grafana-postgresql-datasource/versions/13.0.1/logos… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/prometheus/versions/13.1.7/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/camptocamp-prometheus-alertmanager-datasource/versi… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/crestdata-proofpointtap-datasource/versions/1.0.6/l… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/questdb-questdb-datasource/versions/0.1.8/logos/sma… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/quickwit-quickwit-datasource/versions/0.6.3/logos/s… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/maormil-rabbitmq-datasource/versions/1.0.0/logos/sm… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/redis-datasource/versions/2.2.0/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/ccin2p3-riemann-datasource/versions/0.1.6/logos/sma… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/g42-rqlite-datasource/versions/1.1.5/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/grafana-salesforce-datasource/versions/1.7.23/logos… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/grafana-saphana-datasource/versions/1.7.24/logos/sm… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/grafana-sentry-datasource/versions/2.2.6/logos/smal… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/grafana-servicenow-datasource/versions/2.14.10/logo… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/sift-grafana-datasource/versions/1.4.6/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/tkurki-signalk-datasource/versions/1.1.2/logos/smal… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/innius-grpc-datasource/versions/1.2.13/logos/small |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/monyskow-simpleopcua-datasource/versions/1.1.0/logo… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/apache-skywalking-datasource/versions/0.1.0/logos/s… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/grafana-snowflake-datasource/versions/1.16.5/logos/… |
| 24.1s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/grafana-solarwinds-datasource/versions/0.2.7-previe… |

_…and 377 static assets (scripts, styles, fonts, images) — all under 400, slowest 998ms. They are in `debug.json`._

### The ones that failed

**GET http://localhost:3010/public/build/img/icons/unicons/spinner.svg** → net::ERR_ABORTED (31ms) during `run grafana.openDashboards`

Came back with no readable body: _response.text: Protocol error (Network.getResponseBody): No data found for resource with given identifier
Response body is not available for a response that was_

**GET http://localhost:3010/public/build/img/icons/unicons/spinner.svg** → net::ERR_ABORTED (48ms) during `run grafana.startADashboard`

Came back with no readable body: _response.text: Protocol error (Network.getResponseBody): No data found for resource with given identifier
Response body is not available for a response that was_

**GET http://localhost:3010/public/build/img/icons/unicons/ellipsis-v.svg** → net::ERR_ABORTED (58ms) during `run grafana.openExplore`

**GET http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storag…** → 404 (22ms) during `run grafana.openDataSources`

Came back:
```
{
  "kind": "Status",
  "apiVersion": "v1",
  "metadata": {},
  "status": "Failure",
  "message": "user-storage.userstorage.grafana.app \"advisor-redirect-notice:efvztcn748ydce\" not found",
  "reason": "NotFound",
  "details": {
    "name": "advisor-redirect-notice:efvztcn748ydce",
    "group": "userstorage.grafana.app",
    "kind": "user-storage"
  },
  "code": 404
}
```

## Console (56, 3 of them errors or warnings)

- **warning** during `run grafana.signIn` — Deprecation warning: value provided is not in a recognized RFC2822 or ISO format. moment construction falls back to js Date(), which is not reliable across all browsers and versions. Non RFC2822/ISO date formats are discouraged. Please refer to http://momentjs.com/guides/#/warnings/js-date/ for more info. Arguments: [0] _isAMomentObject: true, _isUTC: false, _useUTC: false, _l: undefined, _i: Fri,… (http://localhost:3010/public/build/6029.ced17922ce65e4fd1ef9.js:620)
- **error** during `run grafana.openDataSources` — Failed to load resource: the server responded with a status of 404 (Not Found) (http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storage/advisor-redirect-notice:efvztcn748ydce:0)
- **error** during `run grafana.openUsers` — Failed to load resource: the server responded with a status of 404 (Not Found) (http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storage/grafana-help-flags:efvztcn748ydce:0)
- debug during `run grafana.signIn` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.signIn` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.signIn` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.signIn` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-exploretraces-app}
- debug during `run grafana.signIn` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-lokiexplore-app}
- debug during `run grafana.signIn` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-metricsdrilldown-app}
- debug during `run grafana.signIn` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-pyroscope-app}
- debug during `run grafana.signIn` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.openDashboards` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.openDashboards` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-exploretraces-app}
- debug during `run grafana.openDashboards` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-lokiexplore-app}
- debug during `run grafana.openDashboards` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-metricsdrilldown-app}
- debug during `run grafana.openDashboards` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-pyroscope-app}
- debug during `run grafana.openDashboards` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.startADashboard` — PluginMeta: initializing app plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- debug during `run grafana.startADashboard` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-exploretraces-app}
- debug during `run grafana.startADashboard` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-lokiexplore-app}
- debug during `run grafana.startADashboard` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-metricsdrilldown-app}
- debug during `run grafana.startADashboard` — PluginSettings: getting legacy plugin settings {source: grafana/runtime.plugins.settings, pluginId: grafana-pyroscope-app}
- debug during `run grafana.startADashboard` — PluginMeta: initializing panel plugins cache with bootdata values {source: grafana/runtime.plugins.meta}
- _…and 33 more logs_

## What the harness itself did

- `GET http://localhost:3010/api/admin/stats` → 200 (22ms) · stats
- `GET http://localhost:3010/api/search` → 200 (11ms) · search

## Where to look

- the recording: `video.mp4`
- the frames: `frames`
- everything, in the trace viewer:
  `npx playwright show-trace .witness/artifacts/test-results/cli-grafana-thewholeproduct/trace.zip`
