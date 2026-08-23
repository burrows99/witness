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

const page = (path: string, yaml: string, placeholders: string[] = []): PageFacts => {
  const nodes = Explore.parse(yaml);
  return { path, nodes, placeholders, links: Explore.links(nodes, new URL("http://localhost:3020")), title: Explore.title(nodes) };
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
  const forms = Explore.forms([page("/user/sign_up", REGISTER, ["Username", "Email Address"])]);
  deepEqual(forms.register, { username: "Username", emailAddress: "Email Address" });
});

test("paths that differ in one segment are one operation with a parameter", () => {
  const operations = Explore.operations([
    { method: "GET", url: "http://localhost:3020/api/v1/repos/7/issues" },
    { method: "GET", url: "http://localhost:3020/api/v1/repos/12/issues" },
    { method: "POST", url: "http://localhost:3020/api/v1/user/repos" },
  ]);
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

test("the fragment says it is a starting point and where it came from", () => {
  const rendered = Explore.render(
    { routes: { home: "/" }, locators: {}, forms: {}, operations: {}, visited: ["/"], skipped: [] },
    "web",
  );
  match(rendered, /Walked 1 page: \//);
  match(rendered, /merge the rest by hand/);
  // It is a fragment for a person to paste, so it has to be shaped like the file they already have.
  ok(rendered.includes('"services"') && rendered.includes('"web"'));
});

test("the service to explore is the one with screens", () => {
  equal(Explore.likelyApp({ services: { db: {}, web: { app: { routes: {} } } } }), "web");
});
