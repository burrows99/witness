# grafana.theWholeProduct — ok (32.4s)

## What it was doing

1. ✓ `slide` Grafana, described — 5.3s · actions/grafana-thewholeproduct/01-slide.png
2. ✓ `run` grafana.signIn — 2.7s · actions/grafana-thewholeproduct/02-run.png
3. ✓ `frame` signed in — 63ms · actions/grafana-thewholeproduct/03-frame.png
4. ✓ `api` what the instance says about itself, before looking at a single screen — 75ms · actions/grafana-thewholeproduct/04-api.png
5. ✓ `slide` What it says it holds — 5.2s · actions/grafana-thewholeproduct/05-slide.png
6. ✓ `run` grafana.openDashboards — 758ms · actions/grafana-thewholeproduct/06-run.png
7. ✓ `frame` dashboards, empty — 34ms · actions/grafana-thewholeproduct/07-frame.png
8. ✓ `api` search — 44ms · actions/grafana-thewholeproduct/08-api.png
9. ✓ `check` the API and the screen should agree about how many dashboards there are — 33ms · actions/grafana-thewholeproduct/09-check.png
10. ✓ `run` grafana.startADashboard — 1.1s · actions/grafana-thewholeproduct/10-run.png
11. ✓ `frame` a new dashboard, unsaved — 56ms · actions/grafana-thewholeproduct/11-frame.png
12. ✓ `slide` Nothing to query yet — 5.3s · actions/grafana-thewholeproduct/12-slide.png
13. ✓ `run` grafana.openExplore — 1.1s · actions/grafana-thewholeproduct/13-run.png
14. ✓ `frame` explore — 48ms · actions/grafana-thewholeproduct/14-frame.png
15. ✓ `run` grafana.openDataSources — 896ms · actions/grafana-thewholeproduct/15-run.png
16. ✓ `frame` no data sources — 41ms · actions/grafana-thewholeproduct/16-frame.png
17. ✓ `caption` What it could connect to — 27ms · actions/grafana-thewholeproduct/17-caption.png
18. ✓ `run` grafana.browseConnections — 2.4s · actions/grafana-thewholeproduct/18-run.png
19. ✓ `check` searching the catalogue for prometheus should offer something — 33ms · actions/grafana-thewholeproduct/19-check.png
20. ✓ `frame` the connection catalogue — 52ms · actions/grafana-thewholeproduct/20-frame.png
21. ✓ `slide` Who can get in — 5.2s · actions/grafana-thewholeproduct/21-slide.png
22. ✓ `run` grafana.openUsers — 775ms · actions/grafana-thewholeproduct/22-run.png
23. ✓ `frame` one account — 57ms · actions/grafana-thewholeproduct/23-frame.png
24. ✓ `check` the user table should hold the accounts the API counted — 17ms · actions/grafana-thewholeproduct/24-check.png
25. ✓ `run` grafana.openProfile — 905ms · actions/grafana-thewholeproduct/25-run.png
26. ✓ `frame` the admin's own page — 50ms · actions/grafana-thewholeproduct/26-frame.png

## Network (500 requests · 3 failed · 42 over a second)

_172 more were not recorded: the run passed the limit._

| at | step | method | status | ms | url |
|---|---|---|---|---|---|
| 5.3s | run grafana.signIn | GET | 200 | 24ms | http://localhost:3010/login |
| 7.0s | run grafana.signIn | POST | 200 | 14ms | http://localhost:3010/login |
| 7.3s | run grafana.signIn | GET | 200 | 18ms | http://localhost:3010/ |
| 7.4s | run grafana.signIn | GET | 200 | 0ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 7.4s | run grafana.signIn | POST | 200 | 12ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 7.5s | run grafana.signIn | GET | 200 | 22ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 7.5s | run grafana.signIn | GET | 200 | 21ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 7.5s | run grafana.signIn | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 7.5s | run grafana.signIn | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 7.8s | run grafana.signIn | GET | 200 | 12ms | http://localhost:3010/api/user/teams |
| 7.8s | run grafana.signIn | GET | 200 | 13ms | http://localhost:3010/api/user/orgs |
| 7.8s | run grafana.signIn | GET | 200 | 17ms | http://localhost:3010/api/user/stars |
| 7.8s | run grafana.signIn | GET | 200 | 17ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 7.8s | run grafana.signIn | GET | 200 | 11ms | http://localhost:3010/apis/dashboard.grafana.app/v0alpha1/namespaces/default/search?type=f… |
| 7.8s | run grafana.signIn | GET | 200 | 84ms | https://grafana.com/blog/news.xml |
| 7.9s | run grafana.signIn | GET | 200 | 23ms | http://localhost:3010/api/alertmanager/grafana/api/v2/alerts?silenced=false&active=true&in… |
| 7.9s | run grafana.signIn | GET | 200 | 1.1s | https://a-us.storyblok.com/f/1022730/1200x628/c30281b487/cost-attribution-meta-image-2.png |
| 7.9s | run grafana.signIn | GET | 200 | 1.1s | https://a-us.storyblok.com/f/1022730/1200x628/2bb858dd83/frontend-o11y-user-experience-met… |
| 13.4s | run grafana.openDashboards | GET | 200 | 9ms | http://localhost:3010/dashboards |
| 13.5s | run grafana.openDashboards | GET | 200 | 0ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 13.6s | run grafana.openDashboards | POST | 200 | 13ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 13.6s | run grafana.openDashboards | GET | 200 | 17ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 13.6s | run grafana.openDashboards | GET | 200 | 2ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 13.6s | run grafana.openDashboards | GET | 200 | 16ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 13.6s | run grafana.openDashboards | GET | 200 | 15ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 13.6s | run grafana.openDashboards | GET | 200 | 18ms | http://localhost:3010/apis/dashboard.grafana.app/v0alpha1/namespaces/default/search?type=f… |
| 14.0s | run grafana.openDashboards | GET | 200 | 17ms | http://localhost:3010/api/folders?page=1&limit=50 |
| 14.0s | run grafana.openDashboards | GET | 200 | 17ms | http://localhost:3010/api/user/orgs |
| 14.0s | run grafana.openDashboards | GET | 200 | 37ms | http://localhost:3010/apis/provisioning.grafana.app/v0alpha1/namespaces/default/settings |
| 14.0s | run grafana.openDashboards | GET | 200 | 17ms | http://localhost:3010/api/folders/general?accesscontrol=true&isLegacyCall=false |
| 14.0s | run grafana.openDashboards | GET | 200 | 20ms | http://localhost:3010/apis/quotas.grafana.app/v0alpha1/namespaces/default/usage?group=dash… |
| 14.0s | run grafana.openDashboards | GET | 200 | 20ms | http://localhost:3010/apis/quotas.grafana.app/v0alpha1/namespaces/default/usage?group=fold… |
| 14.0s | run grafana.openDashboards | GET | 200 | 19ms | http://localhost:3010/api/teams/search?perpage=200&sort=name-asc |
| 14.0s | run grafana.openDashboards | GET | 200 | 20ms | http://localhost:3010/api/user/stars |
| 14.0s | run grafana.openDashboards | GET | 200 | 19ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 14.0s | run grafana.openDashboards | GET | 200 | 22ms | http://localhost:3010/apis/dashboard.grafana.app/v0alpha1/namespaces/default/search?query=… |
| 14.3s | run grafana.startADashboard | GET | 200 | 12ms | http://localhost:3010/dashboard/new |
| 14.4s | run grafana.startADashboard | GET | 200 | 2ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 14.4s | run grafana.startADashboard | POST | 200 | 6ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 14.5s | run grafana.startADashboard | GET | 200 | 4ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 14.5s | run grafana.startADashboard | GET | 200 | 17ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 14.5s | run grafana.startADashboard | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 14.5s | run grafana.startADashboard | GET | 200 | 18ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 14.8s | run grafana.startADashboard | GET | 200 | 4ms | http://localhost:3010/apis/dashboard.grafana.app/ |
| 14.8s | run grafana.startADashboard | GET | 200 | 5ms | http://localhost:3010/api/user/orgs |
| 14.8s | run grafana.startADashboard | GET | 200 | 7ms | http://localhost:3010/api/user/stars |
| 14.8s | run grafana.startADashboard | GET | 200 | 6ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 14.8s | run grafana.startADashboard | GET | **net::ERR_ABORTED** | 50ms | http://localhost:3010/public/build/img/icons/unicons/spinner.svg |
| 20.7s | run grafana.openExplore | GET | 200 | 12ms | http://localhost:3010/explore |
| 20.9s | run grafana.openExplore | GET | 200 | 0ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 20.9s | run grafana.openExplore | POST | 200 | 21ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 20.9s | run grafana.openExplore | GET | 200 | 22ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 20.9s | run grafana.openExplore | GET | 200 | 20ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 20.9s | run grafana.openExplore | GET | 200 | 19ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 20.9s | run grafana.openExplore | GET | 200 | 21ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 21.3s | run grafana.openExplore | GET | 200 | 7ms | http://localhost:3010/api/user/orgs |
| 21.3s | run grafana.openExplore | GET | 200 | 38ms | http://localhost:3010/api/user/stars |
| 21.3s | run grafana.openExplore | GET | 200 | 37ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 21.3s | run grafana.openExplore | GET | 200 | 5ms | http://localhost:3010/api/datasources/correlations?sourceUID=grafana |
| 21.3s | run grafana.openExplore | GET | 200 | 65ms | http://localhost:3010/api/live/list |
| 21.3s | run grafana.openExplore | GET | **net::ERR_ABORTED** | 52ms | http://localhost:3010/public/build/img/icons/unicons/ellipsis-v.svg |
| 21.4s | run grafana.openExplore | POST | 200 | 15ms | http://localhost:3010/api/query-history |
| 21.9s | run grafana.openDataSources | GET | 200 | 9ms | http://localhost:3010/connections/datasources |
| 22.0s | run grafana.openDataSources | GET | 200 | 0ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 22.1s | run grafana.openDataSources | POST | 200 | 9ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 22.1s | run grafana.openDataSources | GET | 200 | 15ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 22.1s | run grafana.openDataSources | GET | 200 | 14ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 22.1s | run grafana.openDataSources | GET | 200 | 13ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 22.1s | run grafana.openDataSources | GET | 200 | 2ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 22.4s | run grafana.openDataSources | GET | 200 | 9ms | http://localhost:3010/api/datasources |
| 22.4s | run grafana.openDataSources | GET | 200 | 9ms | http://localhost:3010/api/user/orgs |
| 22.4s | run grafana.openDataSources | GET | 200 | 13ms | http://localhost:3010/api/user/stars |
| 22.4s | run grafana.openDataSources | GET | 200 | 13ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 22.4s | run grafana.openDataSources | GET | 200 | 14ms | http://localhost:3010/api/plugins/grafana-advisor-app/settings |
| 22.5s | run grafana.openDataSources | GET | 404 | 6ms | http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storag… |
| 22.5s | run grafana.openDataSources | GET | 200 | 5ms | http://localhost:3010/apis/advisor.grafana.app/v0alpha1/namespaces/default/checks?labelSel… |
| 22.5s | run grafana.openDataSources | GET | 200 | 8ms | http://localhost:3010/apis/advisor.grafana.app/v0alpha1/namespaces/default/checktypes/data… |
| 22.8s | run grafana.browseConnections | GET | 200 | 9ms | http://localhost:3010/connections/add-new-connection |
| 22.9s | run grafana.browseConnections | GET | 200 | 102ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences/merge… |
| 23.0s | run grafana.browseConnections | POST | 200 | 4ms | http://localhost:3010/apis/features.grafana.app/v0alpha1/namespaces/default/ofrep/v1/evalu… |
| 23.0s | run grafana.browseConnections | GET | 200 | 15ms | http://localhost:3010/api/plugins/grafana-exploretraces-app/settings |
| 23.0s | run grafana.browseConnections | GET | 200 | 3ms | http://localhost:3010/api/plugins/grafana-lokiexplore-app/settings |
| 23.0s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/plugins/grafana-metricsdrilldown-app/settings |
| 23.0s | run grafana.browseConnections | GET | 200 | 14ms | http://localhost:3010/api/plugins/grafana-pyroscope-app/settings |
| 23.3s | run grafana.browseConnections | GET | 200 | 1ms | http://localhost:3010/api/plugins/errors |
| 23.3s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/plugins?embedded=include-datasource&accesscontrol=true |
| 23.3s | run grafana.browseConnections | GET | 200 | 222ms | http://localhost:3010/api/gnet/plugins?includeDeprecated=true |
| 23.3s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/plugins/errors |
| 23.3s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/plugins?embedded=include-datasource&accesscontrol=true |
| 23.3s | run grafana.browseConnections | GET | 200 | 498ms | http://localhost:3010/api/gnet/plugins?includeDeprecated=true |
| 23.3s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/user/orgs |
| 23.3s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/api/user/stars |
| 23.3s | run grafana.browseConnections | GET | 200 | 2ms | http://localhost:3010/apis/preferences.grafana.app/v1/namespaces/default/preferences?field… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/googlecloud-logging-datasource/versions/1.7.0/logos… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/googlecloud-trace-datasource/versions/1.4.0/logos/s… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.0s | http://localhost:3010/api/gnet/plugins/grafana-googlesheets-datasource/versions/2.6.1/logo… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.0s | http://localhost:3010/api/gnet/plugins/svennergr-hackerone-datasource/versions/1.0.4/logos… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/harperfast-harper-datasource/versions/0.2.0/logos/s… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.0s | http://localhost:3010/api/gnet/plugins/needleinajaystack-haystack-datasource/versions/0.0.… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/apricote-hcloud-datasource/versions/0.3.0/logos/sma… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/grafana-honeycomb-datasource/versions/2.15.4/logos/… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/hydrolix-hydrolix-datasource/versions/0.11.0/logos/… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/grafana-ibmdb2-datasource/versions/2.5.1/logos/smal… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/yesoreyeram-infinity-datasource/versions/4.0.0/logo… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/instana-datasource/versions/5.1.0/logos/small |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/itrs-analytics-datasource/versions/3.3.1/logos/smal… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.1s | http://localhost:3010/api/gnet/plugins/grafana-jenkins-datasource/versions/1.1.0-preview/l… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/grafana-jira-datasource/versions/2.7.4/logos/small |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/simpod-json-datasource/versions/0.6.7/logos/small |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/marcusolsson-json-datasource/versions/1.4.1/logos/s… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/nagasudhirpulla-api-datasource/versions/1.2.4/logos… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/hamedkarbasi93-kafka-datasource/versions/1.7.2/logo… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/aquaqanalytics-kdbbackend-datasource/versions/1.0.0… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.2s | http://localhost:3010/api/gnet/plugins/kentik-connect-datasource/versions/3.0.0/logos/smal… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/kinetica-grafana-datasource/versions/1.0.9/logos/sm… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/grafana-logicmonitor-datasource/versions/0.5.0-prev… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/grafana-looker-datasource/versions/0.4.19/logos/sma… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/bsull-materialize-datasource/versions/0.1.1/logos/s… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/manassehzhou-maxcompute-datasource/versions/0.0.2/l… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/grafana-mock-datasource/versions/0.2.5/logos/small |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/dataspex-monetdb-datasource/versions/0.2.0/logos/sm… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/grafana-mongodb-datasource/versions/2.0.1/logos/sma… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/grafana-mqtt-datasource/versions/1.3.6/logos/small |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/arabian9ts-mux-datasource/versions/0.1.5/logos/smal… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/kniepdennis-neo4j-datasource/versions/1.3.2/logos/s… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/crestdata-netappontap-datasource/versions/1.0.5/log… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.3s | http://localhost:3010/api/gnet/plugins/netdatacloud-netdata-datasource/versions/3.0.4/logo… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.4s | http://localhost:3010/api/gnet/plugins/grafana-netlify-datasource/versions/0.1.7-preview/l… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.4s | http://localhost:3010/api/gnet/plugins/grafana-newrelic-datasource/versions/4.6.24/logos/s… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.4s | http://localhost:3010/api/gnet/plugins/hamedkarbasi93-nodegraphapi-datasource/versions/1.0… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.5s | http://localhost:3010/api/gnet/plugins/nominal-nominalds-datasource/versions/0.13.0/logos/… |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.4s | http://localhost:3010/api/gnet/plugins/dvelop-odata-datasource/versions/1.2.1/logos/small |
| 23.9s | run grafana.browseConnections | GET | 200 | 1.5s | http://localhost:3010/api/gnet/plugins/opengemini-opengemini-datasource/versions/1.1.0/log… |

_…and 367 static assets (scripts, styles, fonts, images) — all under 400, slowest 994ms. They are in `debug.json`._

### The ones that failed

**GET http://localhost:3010/public/build/img/icons/unicons/spinner.svg** → net::ERR_ABORTED (50ms) during `run grafana.startADashboard`

Came back with no readable body: _response.text: Protocol error (Network.getResponseBody): No data found for resource with given identifier
Response body is not available for a response that was_

**GET http://localhost:3010/public/build/img/icons/unicons/ellipsis-v.svg** → net::ERR_ABORTED (52ms) during `run grafana.openExplore`

**GET http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storag…** → 404 (6ms) during `run grafana.openDataSources`

Came back:
```
{
  "kind": "Status",
  "apiVersion": "v1",
  "metadata": {},
  "status": "Failure",
  "message": "user-storage.userstorage.grafana.app \"advisor-redirect-notice:dfvzp4t4u91xcc\" not found",
  "reason": "NotFound",
  "details": {
    "name": "advisor-redirect-notice:dfvzp4t4u91xcc",
    "group": "userstorage.grafana.app",
    "kind": "user-storage"
  },
  "code": 404
}
```

## Console (56, 3 of them errors or warnings)

- **warning** during `run grafana.signIn` — Deprecation warning: value provided is not in a recognized RFC2822 or ISO format. moment construction falls back to js Date(), which is not reliable across all browsers and versions. Non RFC2822/ISO date formats are discouraged. Please refer to http://momentjs.com/guides/#/warnings/js-date/ for more info. Arguments: [0] _isAMomentObject: true, _isUTC: false, _useUTC: false, _l: undefined, _i: Fri,… (http://localhost:3010/public/build/6029.ced17922ce65e4fd1ef9.js:620)
- **error** during `run grafana.openDataSources` — Failed to load resource: the server responded with a status of 404 (Not Found) (http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storage/advisor-redirect-notice:dfvzp4t4u91xcc:0)
- **error** during `run grafana.openUsers` — Failed to load resource: the server responded with a status of 404 (Not Found) (http://localhost:3010/apis/userstorage.grafana.app/v0alpha1/namespaces/default/user-storage/grafana-help-flags:dfvzp4t4u91xcc:0)
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

- `GET http://localhost:3010/api/admin/stats` → 200 (30ms) · stats
- `GET http://localhost:3010/api/search` → 200 (20ms) · search

## Where to look

- the recording: `video.mp4`
- the frames: `frames`
- everything, in the trace viewer:
  `npx playwright show-trace .witness/artifacts/test-results/cli-grafana-thewholeproduct/trace.zip`
