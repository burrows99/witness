import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";

import { Explore, type PageFacts } from "./explore.ts";

/** The real thing, taken from Gitea's registration screen. */
const REGISTER = `- navigation "Navigation Bar":
  - link "Home":
    - /url: /
  - link "Explore":
    - /url: /explore/repos
  - link "Help":
    - /url: https://docs.gitea.com
  - link "Sign In":
    - /url: /user/login?redirect_to=%2fuser%2fsign_up
- main "Register":
  - heading "Register" [level=4]
  - text: Username *
  - textbox "Username *"
  - button "Register Account"
  - link "Already have an account? Sign in now!":
    - /url: /user/login
`;

/**
 * The real thing again, from Mailpit: an inbox and one message, with the two live values that made
 * two runs of the same command disagree — the id in the path, and the score in the tab.
 *
 * Taken off the running stack rather than written here, because a fixture invented alongside the
 * code it feeds only proves the two agree. The `/view/false` links are Mailpit's own disabled
 * previous/next buttons; the `/search?q=…` ones are its From and To addresses.
 */
const INBOX = (id: string) => `- link "MailpitMailpit":
  - /url: /
  - img "Mailpit"
  - text: Mailpit
- textbox "Search":
  - /placeholder: Search mailbox
- button " Inbox"
- button " Delete all"
- link "gitea@witness.example To: witness-admin@example.com Recover your account 2.2 kB 4 hours ago":
  - /url: /view/${id}
`;

const MESSAGE = (id: string, score: number) => `- link "MailpitMailpit":
  - /url: /
- button " Mark unread"
- link "":
  - /url: /view/false
- link "":
  - /url: /view/false
- button " Return to inbox"
- table:
  - row "From <gitea@witness.example>":
    - cell "<gitea@witness.example>":
      - link "gitea@witness.example":
        - /url: /search?q=gitea%40witness.example
  - row "To <witness-admin@example.com>":
    - cell "<witness-admin@example.com>":
      - link "witness-admin@example.com":
        - /url: /search?q=witness-admin%40example.com
- tablist:
  - tab "HTML" [selected]
  - tab "Raw"
  - tab "HTML Check ${score}%"
  - tab "Link Check"
`;

const page = (path: string, yaml: string, fields: PageFacts["fields"] = []): PageFacts => {
  const nodes = Explore.parse(yaml);
  return { path, nodes, fields, links: Explore.links(nodes, new URL("http://localhost:3020")), title: Explore.title(nodes) };
};

test("an aria snapshot becomes nodes that remember their depth", () => {
  const nodes = Explore.parse(REGISTER);
  const button = nodes.find(n => n.role === "button");
  deepEqual({ role: button?.role, name: button?.name }, { role: "button", name: "Register Account" });
  const heading = nodes.find(n => n.role === "heading");
  equal(heading?.attrs, "level=4");
  // The link is shallower than the `/url` beneath it: that nesting is how a route learns its name.
  const link = nodes.findIndex(n => n.role === "link" && n.name === "Home");
  ok(nodes[link].depth < nodes[link + 1].depth);
});

test("a line the format grows later is skipped, not thrown over", () => {
  // A config generator failing on one unrecognised line would be worse than one that misses it.
  const nodes = Explore.parse('- button "Ok"\n  something entirely new\n- /url: /x\n');
  deepEqual(
    nodes.map(n => n.role),
    ["button", "/url"],
  );
});

test("routes are named for the words a person clicks", () => {
  const routes = Explore.routes([page("/user/sign_up", REGISTER)]);
  equal(routes.home, "/");
  equal(routes.explore, "/explore/repos");
  // The query is state, not a route: two links to the login screen are one screen.
  equal(routes.signIn, "/user/login");
});

test("a link whose text is a sentence is named for its path instead", () => {
  // `alreadyHaveAnAccountSignInNow` is a worse identifier than `userLogin`, and both point at the
  // same screen — so the sentence must never be the one that wins.
  ok(!Object.keys(Explore.routes([page("/user/sign_up", REGISTER)])).some(name => name.length > 24));
});

test("a name that is not an identifier falls back to the path", () => {
  // A star-count link ("0") gave routes called `0` and `02` in the first fragment this produced
  // against a real app — not identifiers, and not readable either.
  equal(Explore.name("0", "/witness-admin/witness-demo/stars"), "witnessAdminWitnessDemo");
  equal(Explore.name("12", ""), "");
});

test("a name too long to keep is cut at a word", () => {
  // `aPainlessSelfHostedGitSe` is worse than the truncation being visible.
  const name = Explore.name("A painless, self-hosted Git service", "");
  equal(name, "aPainlessSelfHostedGit");
  ok(name.length <= 24);
});

test("an off-site link is somebody else's app", () => {
  const routes = Explore.routes([page("/user/sign_up", REGISTER)]);
  // Every route is a PATH on this origin — the stronger claim, and the one that matters. Asking
  // instead whether some off-site host appears in the string is the substring-URL-check that reads
  // as sanitisation and is not one: a host can sit anywhere in a URL.
  ok(Object.values(routes).every(path => path.startsWith("/")));
  // The snapshot links to docs.gitea.com, and the four routes here are the four same-origin ones.
  deepEqual(Object.values(routes).sort(), ["/", "/explore/repos", "/user/login", "/user/sign_up"]);
});

test("locators are what a step would assert on, and never a link", () => {
  const locators = Explore.locators([page("/user/sign_up", REGISTER)]);
  deepEqual(locators.registerAccount, { role: "button", name: "Register Account" });
  // Links are already routes. Naming each one twice doubles a fragment nobody would then read.
  ok(!Object.values(locators).some(spec => (spec as { role?: string }).role === "link"));
});

test("a locator that matches twice is not offered as one", () => {
  // Offering an ambiguous locator is how a generated description quietly becomes a source of flakes.
  const twice = '- button "Delete"\n- button "Delete"\n- button "Save"\n';
  const locators = Explore.locators([page("/x", twice)]);
  deepEqual(Object.keys(locators), ["save"]);
});

test("forms carry the placeholder that finds the input, not the label", () => {
  // `forms` is consumed with getByPlaceholder. An accessible name is the LABEL wherever there is
  // one, so reading these off the aria tree would produce a form that cannot fill anything.
  const forms = Explore.forms([
    page("/user/sign_up", REGISTER, [
      { name: "user_name", placeholder: "Username" },
      { name: "email", placeholder: "Email Address" },
    ]),
  ]);
  deepEqual(forms.register, { userName: "Username", email: "Email Address" });
});

test("a field is named for what it is, not for the example data in it", () => {
  // From a real signup form: the email box was called `youOrganisationCh` and the name box
  // `adaLovelace`, because both were named from the sample value a designer had typed into the mock.
  // The placeholder is the right thing to MATCH on and the wrong thing to NAME from.
  const forms = Explore.forms([
    page("/register", '- main "Create your account"\n', [
      { name: "full_name", placeholder: "Ada Lovelace" },
      { name: "email", placeholder: "you@organisation.ch" },
    ]),
  ]);
  deepEqual(forms.createYourAccount, { fullName: "Ada Lovelace", email: "you@organisation.ch" });
  // And a `name` attribute that is not an identifier falls back to the placeholder rather than to
  // nothing: a form named from example data beats no form at all, which is what dropping it means.
  deepEqual(Explore.forms([page("/x", '- main "Search"\n', [{ name: "2", placeholder: "Find a repository" }])]).search, {
    findARepository: "Find a repository",
  });
});

test("the same form on three pages is one form", () => {
  // `welcomeBack`, `welcomeBack2`, `welcomeBack3` — one sign-in box seen on three routes. The rule
  // that stops a name collision from silently dropping an entry cannot tell a collision from a
  // repeat, so it renamed rather than recognised.
  const signIn = [
    { name: "user", placeholder: "email or username" },
    { name: "password", placeholder: "password" },
  ];
  const forms = Explore.forms([
    page("/login", '- main "Welcome back"\n', signIn),
    page("/settings", '- main "Welcome back"\n', signIn),
    page("/reports", '- main "Welcome back"\n', signIn),
    page("/reset", '- main "Forgot your password"\n', [{ name: "user", placeholder: "Email or username" }]),
  ]);
  deepEqual(Object.keys(forms), ["welcomeBack", "forgotYourPassword"]);
});

test("paths that differ in one segment are one operation with a parameter", () => {
  const operations = Explore.operations([
    { method: "GET", url: "http://localhost:3020/api/v1/repos/7/issues" },
    { method: "GET", url: "http://localhost:3020/api/v1/repos/12/issues" },
    { method: "POST", url: "http://localhost:3020/api/v1/user/repos" },
    // An asset fetched with `fetch()` is still an asset — Grafana loads its icons this way.
    { method: "GET", url: "http://localhost:3010/public/build/img/icons/unicons/eye.svg" },
  ]);
  deepEqual(
    Object.keys(operations).filter(name => /svg/i.test(name)),
    [],
  );
  deepEqual(operations["repos.byId.issues"], { method: "GET", path: "/api/v1/repos/{id}/issues" });
  // The method only enters the name when it has to: `user.repos` reads better than `user.repos.get`.
  deepEqual(operations["user.repos.post"], { method: "POST", path: "/api/v1/user/repos" });
});

test("a crawl stops at its limits and says what it left out", async () => {
  // A fragment that stopped early looks exactly like one that found everything, which is the whole
  // reason the cap is reported rather than just applied.
  const found = await Explore.crawl({
    origin: "http://localhost:3020",
    maxPages: 1,
    maxDepth: 3,
    read: async () => ({ ...page("/", REGISTER) }),
  });
  equal(found.visited.length, 1);
  ok(found.skipped.length > 0);
  match(found.skipped.join("\n"), /1-page limit/);
  // Each path named once. A path still queued behind several pages used to be reported once per
  // page that linked to it, in a list whose whole job is to be read.
  deepEqual(found.skipped, [...new Set(found.skipped)]);
});

test("a page that cannot be read is reported rather than dropped", async () => {
  const found = await Explore.crawl({ origin: "http://localhost:3020", from: ["/gone"], maxPages: 5, maxDepth: 1, read: async () => undefined });
  deepEqual(found.visited, []);
  match(found.skipped.join("\n"), /\/gone — could not be read/);
});

test("a link that LANDS somewhere else is dropped rather than described", async () => {
  // The same-origin test used to be made against the href, so a path on this origin that answers 302
  // passed it and the crawl described somebody else's sign-in screen as the product's own — a git
  // forge whose description offered "Email, phone, or Skype". Where a navigation lands is the only
  // version of the question worth asking, and it can only be asked after the navigation.
  const found = await Explore.crawl({
    origin: "http://localhost:3010",
    from: ["/login", "/away"],
    maxPages: 5,
    maxDepth: 0,
    read: async url =>
      url.endsWith("/away")
        ? { ...page("/away", '- heading "We are sorry..." [level=1]\n'), url: "http://localhost:8092/realms/master" }
        : { ...page("/login", REGISTER), url },
  });
  deepEqual(found.visited, ["/login"]);
  match(found.skipped.join("\n"), /\/away — left this origin for http:\/\/localhost:8092/);
  // And nothing it says about the product came from there.
  ok(!("weAreSorry" in found.locators));
});

test("a sign-in that hands off to an identity provider is never requested at all", async () => {
  // Not "walked and discarded": every OAuth start endpoint is a same-origin link on the login page of
  // a very large number of applications, and walking an app must not send a third party a request
  // because somebody typed `config explore`. The landed-origin check is the backstop; this is the
  // half that sends nothing.
  const asked: string[] = [];
  const found = await Explore.crawl({
    origin: "http://localhost:3010",
    from: ["/login", "/login/generic_oauth", "/user/oauth2/keycloak", "/api/auth/idp/microsoft/start", "/saml/acs", "/sso"],
    maxPages: 9,
    maxDepth: 0,
    read: async url => {
      asked.push(new URL(url).pathname);
      return { ...page("/login", REGISTER), url };
    },
  });
  deepEqual(asked, ["/login"]);
  equal(found.skipped.length, 5);
  match(Explore.render(found, "grafana"), /generic_oauth — hands off to an identity provider/);
});

test("the login form itself is still walked", async () => {
  // A checker that cries wolf is worse than none: `/lessons` contains `sso`, and the app's own login
  // page is the one screen a description most needs.
  const found = await Explore.crawl({
    origin: "http://localhost:3020",
    from: ["/user/login", "/auth/login", "/lessons"],
    maxPages: 5,
    maxDepth: 0,
    read: async url => ({ ...page("/", REGISTER), url }),
  });
  deepEqual(found.visited, ["/user/login", "/auth/login", "/lessons"]);
  deepEqual(found.skipped, []);
});

test("a page with nothing to do on it is said out loud", async () => {
  // `Walked 1 page` reads exactly like "your app has one page", and for three client-rendered apps
  // in seven it meant the opposite. An empty page is nearly always a mistake, and this is the only
  // thing positioned to notice.
  const shell = "- generic:\n  - generic\n";
  const found = await Explore.crawl({
    origin: "http://localhost:3010",
    maxPages: 5,
    maxDepth: 1,
    read: async () => ({ ...page("/", shell) }),
  });
  deepEqual(found.empty, ["/"]);
  match(Explore.render(found, "grafana"), /Nothing to do on: \//);

  // A title and nothing else counts, which is the whole of Keycloak's console: one heading reading
  // "We are sorry...", no link and no control. A page you can only read the name of is a dead end,
  // and the heading is still offered as a locator — it is just not a way through.
  const dead = await Explore.crawl({
    origin: "http://localhost:8092",
    maxPages: 5,
    maxDepth: 1,
    read: async () => ({ ...page("/", '- heading "We are sorry..." [level=1]\n') }),
  });
  deepEqual(dead.empty, ["/"]);
  deepEqual(Object.keys(Explore.locators([page("/", '- heading "We are sorry..." [level=1]\n')])), ["weAreSorry"]);
  // And a page with anything on it is not accused of being empty.
  const real = await Explore.crawl({
    origin: "http://localhost:3020",
    maxPages: 5,
    maxDepth: 0,
    read: async () => ({ ...page("/", REGISTER) }),
  });
  deepEqual(real.empty, []);
});

test("the fragment says it is a starting point and where it came from", () => {
  const rendered = Explore.render(
    { routes: { home: "/" }, locators: {}, forms: {}, operations: {}, visited: ["/"], skipped: [], empty: [] },
    "web",
  );
  match(rendered, /Walked 1 page: \//);
  match(rendered, /merge the rest by hand/);
  // It is a fragment for a person to paste, so it has to be shaped like the file they already have.
  ok(rendered.includes('"services"') && rendered.includes('"web"'));
});

/**
 * Both of these ask the shape `loadConfig` RETURNS, not the shape a config is written in.
 *
 * A service's `app` block is hoisted into `apps` and removed from the service when the config is
 * read. Asking `services.web.app` — which is what these two did — is a question every real caller
 * answers with `undefined`, so the crawl started at `/` on every described app and `likelyApp`
 * picked whichever service was written first.
 */
test("the service to explore is the one with a screen", () => {
  equal(Explore.likelyApp({ apps: { web: { service: "web", routes: {} } }, services: { db: {}, web: {} } }), "web");
  // An app can be named for itself and point at a service called something else.
  equal(Explore.likelyApp({ apps: { site: { service: "gitea" } }, services: { gitea: {} } }), "gitea");
  // Nothing declares a screen at all: the state `init` leaves a config in, since a compose file says
  // which services exist and not which of them a person looks at.
  equal(Explore.likelyApp({ services: { gitea: {}, postgres: {} } }), "gitea");
});

test("a crawl starts from the routes the config already declares", () => {
  const loaded = {
    apps: { grafana: { service: "grafana", routes: { login: "/login", home: "/", user: "/admin/users/{id}" } } },
    services: { grafana: {}, postgres: {} },
  };
  // A route with a parameter cannot be visited without a value, so it is not a starting point.
  deepEqual(Explore.startingRoutes(loaded, "grafana"), ["/login", "/"]);
  deepEqual(Explore.startingRoutes(loaded, "postgres"), []);
});

/**
 * The check nothing here was doing: run it twice and diff.
 *
 * Every other test in this file asks one question of one function. This one asks the question a
 * person asks — is what it wrote down last week what it writes down today — and it is the only shape
 * that could have caught what it catches, which is why three separate defects survived a green suite.
 *
 * The two runs are the same app with its data moved on: a different message on top, a different
 * spam score in the tab. Nothing about the product changed, so nothing about the description may.
 */
test("two runs against the same app write down the same thing", async () => {
  const run = async (id: string, score: number): Promise<string> =>
    Explore.render(
      await Explore.crawl({
        origin: "http://localhost:8025",
        maxPages: 4,
        maxDepth: 2,
        requests: [
          { method: "GET", url: `http://localhost:8025/api/v1/message/${id}` },
          { method: "GET", url: `http://localhost:8025/api/v1/message/${id}/html-check` },
          { method: "GET", url: "http://localhost:8025/api/v1/messages" },
        ],
        read: async url => {
          const path = new URL(url).pathname;
          return { ...(path === "/" ? page("/", INBOX(id)) : page(path, MESSAGE(id, score))), url };
        },
      }),
      "mailpit",
    );

  const first = await run("m8Ms2n2xDXX2JUyFCX8v5E", 95);
  const second = await run("kQ1p7Zz9RRt4VbnMLc3xW2", 71);
  equal(first, second);
  // And it is the honest version that is stable, not an empty one: the screens are still there, the
  // message just is not.
  match(first, /"\/view\/\{id\}"/);
  match(first, /"htmlCheck"/);
  match(first, /"\/api\/v1\/message\/\{id\}\/html-check"/);
});

test("a route with an id in it describes the screen, not the row", () => {
  const routes = Explore.routes([page("/", INBOX("m8Ms2n2xDXX2JUyFCX8v5E"))]);
  // `/view/m8Ms2n2xDXX2JUyFCX8v5E` describes one message that will be gone tomorrow.
  equal(routes.view, "/view/{id}");
  // `operations` has collapsed paths like this since it was written; routes never did, and the two
  // now do it with the same function. Digits and UUIDs were all it knew, which is why Mailpit's ids
  // went through untouched — most id schemes are neither.
  equal(Explore.templated("/api/v1/repos/7/issues"), "/api/v1/repos/{id}/issues");
  equal(Explore.templated("/orgs/9f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8/edit"), "/orgs/{id}/edit");
  // And a word with a number in it is not an id: a real path must survive this untouched.
  equal(Explore.templated("/connections/datasources"), "/connections/datasources");
  equal(Explore.templated("/user/password/send-reset-email"), "/user/password/send-reset-email");
});

test("a malformed href never becomes a route", () => {
  // A stray quote in an href on a real page produced `"welcomeBack2": "/%22"`, and a template with
  // no id behind it produced `/view/false`. `new URL()` accepts both, and nothing else asked.
  const junk = '- link "Sign in":\n  - /url: "\n- link "Next":\n  - /url: /view/false\n- link "Home":\n  - /url: /\n';
  deepEqual(Object.values(Explore.routes([page("/", junk)])).sort(), ["/"]);
  // Nor is either of them requested: a path nobody meant is not a page to walk.
  deepEqual(Explore.links(Explore.parse(junk), new URL("http://localhost:8025")), ["/"]);
});

test("a locator is not named after a number the app rendered", () => {
  // Two runs hours apart against an unchanged app: lost `htmlCheck` and `inbox1`, gained
  // `htmlCheck95`. The name is also what RESOLVES it, so `HTML Check 95%` stops finding the tab the
  // moment the score is not 95 — the stable part has to replace the name, not just name it.
  const locators = Explore.locators([page("/view/x", MESSAGE("x", 95))]);
  deepEqual(locators.htmlCheck, { role: "tab", name: "HTML Check" });
  equal("htmlCheck95" in locators, false);
  // A name that is nothing but its number has no stable part, and a volatile locator is worse than
  // an ambiguous one — which is already dropped.
  deepEqual(Explore.locators([page("/x", '- button "95%"\n- button "Save"\n')]), {
    save: { role: "button", name: "Save" },
  });
});

test("a page is recorded where it landed, not where it was asked for", async () => {
  // Signed out, Grafana answers `/` and `/connections/datasources` with the same login screen. Asked
  // for rather than landed on, that was two routes named for a title belonging to neither, and four
  // copies of one form.
  const login = '- main "Welcome to Grafana":\n  - link "Forgot your password?":\n    - /url: /user/password/send-reset-email\n';
  const found = await Explore.crawl({
    origin: "http://localhost:3010",
    from: ["/login", "/", "/connections/datasources"],
    maxPages: 6,
    maxDepth: 0,
    read: async url => ({ ...page(new URL(url).pathname, login), url: "http://localhost:3010/login" }),
  });
  deepEqual(found.visited, ["/login"]);
  match(found.skipped.join("\n"), /\/connections\/datasources — landed on \/login, which was already walked/);
  deepEqual(Object.values(found.routes).sort(), ["/login", "/user/password/send-reset-email"]);
});
