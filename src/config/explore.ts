import type { Page } from "@playwright/test";

import { identityCookies } from "../browser/identities.ts";
import { requirePlaywright } from "../browser/playwright.ts";
import type { LocatorSpec } from "../browser/locator.ts";
import { type Params, resolveAction } from "../actions/engine.ts";

/**
 * A description, read off the running app.
 *
 * The sibling of {@link Template}, and the other half of one job: a template is what a config COULD
 * say, generated from the types; this is what it SHOULD say for one product, generated from the
 * product. Between them, `init` stops handing somebody a file of `"<name>": "…"` to fill in from
 * memory — which is where the first draft of a description goes wrong every time. Five of the first
 * nine actions written in this repository named something that did not exist.
 *
 * Almost none of this is new work. Playwright's `page.ariaSnapshot()` returns the accessibility tree
 * as YAML — `role "name" [attrs]` — which is the same shape as a {@link LocatorSpec}, so the
 * translation is a rename rather than a parse of anything. What Playwright has no answer for is
 * finding the pages in the first place: there is no crawler in the library or in its MCP server. That,
 * and emitting a DESCRIPTION rather than test code, is the part that had to be written.
 *
 * It never writes the config. A generated name is worse than the one a person would choose, and a
 * tool that overwrites hand-tuned names is a tool people stop running.
 */
export class Explore {
  /**
   * The roles worth naming: what a step would assert on, and what {@link locators} offers.
   *
   * One list rather than two, because {@link barren} asks the same question from the other end and two
   * would have drifted the first time either grew a role. It reads that list minus `heading`, which is
   * the one difference between them: a title is something to read, not something to do.
   */
  private static readonly worth = new Set(["button", "heading", "checkbox", "radio", "tab", "switch", "combobox"]);

  /**
   * Paths that begin a sign-in somewhere else, and are therefore not walked.
   *
   * `/login/generic_oauth`, `/user/oauth2/keycloak`, `/api/auth/idp/microsoft/start` — every one of
   * them a link on the app's OWN origin, and every one of them a 302 to an identity provider. The
   * shape is on the login page of a very large number of applications, so a tool whose pitch is
   * "point it at your stack" must not send Microsoft a request because somebody typed
   * `config explore`. Nothing is fetched: this is tested against the path, before any navigation.
   *
   * The same reasoning as `click` being skipped for terminal recordings — where the safe thing and
   * the complete thing disagree, do less and say so. Skipped paths are named in the fragment, so a
   * person who does want one described can declare it by hand.
   *
   * Bounded rather than a bare substring on each side, because `/lessons` contains `sso` and a
   * checker that cries wolf is worse than none.
   */
  private static readonly handoff = /(?:^|[/_-])(?:oauth\d*|saml|sso|idp)(?:[/_-]|$)|\/auth\/[^/]+\/start/i;

  /**
   * Walk an app and report what it says about itself.
   *
   * Breadth-first from the routes already declared, or from `/` when there are none — so exploring a
   * described app deepens the description rather than starting it over.
   */
  static async crawl(input: CrawlInput): Promise<Discovery> {
    const origin = new URL(input.origin);
    const queue: { path: string; depth: number }[] = (input.from?.length ? input.from : ["/"]).map(path => ({ path, depth: 0 }));
    const seen = new Set<string>();
    const skipped: string[] = [];
    const empty: string[] = [];
    const pages: PageFacts[] = [];

    while (queue.length) {
      const next = queue.shift()!;
      // Seen, said and remembered as the SCREEN rather than the row: `/view/aB3…` and `/view/xQ9…`
      // are one page a description should carry once, and the id in either of them is data that will
      // be gone next week. The queue keeps the real path — that is what gets fetched — and everything
      // written down uses this one.
      const route = Explore.templated(next.path);
      if (seen.has(route)) continue;
      // Marked seen even when it is skipped. Without this a path still in the queue behind several
      // pages was reported once per page that linked to it — three identical lines about
      // `/user/login`, in a list whose whole job is to be read.
      seen.add(route);
      if (Explore.handoff.test(next.path)) {
        skipped.push(`${route} — hands off to an identity provider; walking it would send a third party a request`);
        continue;
      }
      if (pages.length >= input.maxPages) {
        // Counted and named rather than truncated in silence: a fragment that stopped early looks
        // exactly like one that found everything.
        skipped.push(`${route} — past the ${input.maxPages}-page limit`);
        continue;
      }

      const facts = await input.read(new URL(next.path, origin).toString());
      if (!facts) {
        skipped.push(`${route} — could not be read`);
        continue;
      }
      // Where a link POINTS is not where it lands, and only the second one is same-origin in any
      // useful sense. A path on this origin that answers 302 defeats a check on the href entirely:
      // the first fragment this produced against an app with social sign-in described Microsoft's
      // login screen — "Email, phone, or Skype" — as the product's own. Judged after the navigation,
      // on the URL that ended up in the bar, and the page dropped rather than read.
      const landed = facts.url ? Explore.elsewhere(facts.url, origin) : undefined;
      if (landed) {
        skipped.push(`${route} — left this origin for ${landed}`);
        continue;
      }
      // The path it LANDED on, not the one it asked for. Signed out, Grafana answers `/` and
      // `/connections/datasources` with the same login screen — recorded as asked, that was two
      // routes named after a title belonging to neither and four copies of one form. It is also
      // where the crawl was non-deterministic: whether a redirect's shell rendered a link before the
      // client-side bounce decided how many pages got walked.
      const path = Explore.templated((facts.url && Explore.samePath(facts.url, origin)) || next.path);
      if (path !== route && seen.has(path)) {
        skipped.push(`${route} — landed on ${path}, which was already walked`);
        continue;
      }
      seen.add(path);
      pages.push({ ...facts, path });
      // A page that offered nothing is reported rather than counted. `Walked 1 page` reads exactly
      // like "your app has one page", and for three apps in seven it meant the opposite.
      if (Explore.barren(facts)) empty.push(path);

      if (next.depth >= input.maxDepth) continue;
      for (const link of facts.links) {
        if (!seen.has(Explore.templated(link))) queue.push({ path: link, depth: next.depth + 1 });
      }
    }

    return {
      routes: Explore.routes(pages),
      locators: Explore.locators(pages),
      forms: Explore.forms(pages),
      unfillable: Explore.unfillable(pages),
      operations: Explore.operations(input.requests ?? []),
      visited: pages.map(page => page.path),
      skipped,
      empty,
      // Every page walked wants a password: the crawl never got in. Said as what was OBSERVED rather
      // than as "these were all sign-in screens", because one page of an app can carry an optional
      // password box without being a login — microbin's paste form does. Every page carrying one is
      // a different claim, and it is the one that means the front door was as far as this got.
      behindSignIn: pages.length > 0 && pages.every(page => page.fields.some(field => field.password)),
    };
  }

  /**
   * Nowhere to go and nothing to do: no link to follow, and nothing a step could click or type into.
   *
   * Not "the snapshot was small" — a sign-in screen is four nodes and worth having. And a HEADING does
   * not count, which is the difference between this firing and not: Keycloak's console answers with one
   * heading reading "We are sorry..." and no other node, and a page a person can only read the title of
   * is the case this is for. The heading is still offered as a locator; it is just not a way through.
   */
  private static barren(facts: Omit<PageFacts, "path">): boolean {
    return !facts.links.length && !facts.nodes.some(node => node.name && node.role !== "heading" && Explore.worth.has(node.role));
  }

  /**
   * Which service to walk when nobody said.
   *
   * The first one that declares screens, because that is what "explore the app" means in a stack
   * where four things are running and three of them have no screen at all.
   *
   * Asked of `apps`, not of the services. A service's own `app` block is hoisted out of it when the
   * config is read — "the nested halves are removed rather than left" — so a config that has been
   * through the front door has no `services.web.app` for this to find, and this picked whichever
   * service happened to be written first. Usually the app; on a config that opens with its database,
   * a crawl of the database.
   */
  static likelyApp(config: ExplorableSystem["config"]): string {
    const app = Object.entries(config.apps ?? {})[0];
    if (app) return app[1].service ?? app[0];
    // Nothing declares a screen at all — the state `init` leaves a config in, because a compose file
    // says which services exist and not which of them a person looks at.
    const first = Object.keys(config.services ?? {})[0];
    if (!first) throw new Error("the config declares no services to explore");
    return first;
  }

  /**
   * Where to start: the routes this service already declares.
   *
   * The other half of the same hoisting. This asked services for an `app` that is no longer on them,
   * got `{}` every time, and fell back to `/` — so "exploring a described app deepens the description
   * rather than starting it over" was true of the code and not of anything that ran it. On Grafana it
   * cost `/login` and `/connections/datasources`, the two pages with anything on them.
   */
  static startingRoutes(config: ExplorableSystem["config"], service: string): string[] {
    const app = Object.entries(config.apps ?? {}).find(([name, spec]) => (spec.service ?? name) === service);
    // A route with a parameter cannot be visited without a value, so it is not a starting point.
    return Object.values(app?.[1].routes ?? {}).filter(route => !route.includes("{"));
  }

  /**
   * The same crawl, driven against a whole system — its origin, its identities, its declared routes.
   *
   * `as` names an action to run before the walk starts — any declared one, resolved the way
   * `action run` resolves a name and driven on the page the crawl then walks with, so whatever it
   * leaves behind is what every later navigation carries. A sign-in, an upload, a seed: anything that
   * leaves the app in the state worth describing. The one shape refused is an action with no screen.
   *
   * A sign-in is the commonest of those and it is not the definition. Measured on three applications
   * nobody here chose: grocy — stock, chores, recipes, equipment — walked ONE page, `/login`, and so
   * did linkding; the only one of the three that described usefully was the only one with no
   * authentication. Every app the tool had been pointed at until then happened to have a large
   * anonymous surface, which flattered it.
   *
   * A login is not the only gate, and for a while this argument was named, helped and errored as
   * though it were — which is the same as not having it. An app whose landing screen is a dropzone
   * walked one page here too, for a reason with no login in it: its submit is bound to a file having
   * been chosen and its other routes each take an id that only exists once one has been uploaded, so
   * nothing links anywhere until something has been dropped on it. The session that hit it read the
   * documentation, concluded the harness could reach exactly one screen of that app unaided, and
   * routed the whole flow around it through the API. `--as` had been there the whole time.
   *
   * Named as an ACTION rather than typed here, because whatever state a crawl needs is already
   * described as one — the same reason `check drift` takes its sign-in that way.
   */
  static async of(
    system: ExplorableSystem,
    service: string,
    opts: { maxPages?: number; maxDepth?: number; as?: string } = {},
  ): Promise<Discovery> {
    const origin = system.stack.endpoints[service];
    if (!origin) {
      throw new Error(`no service "${service}" — the config declares: ${Object.keys(system.stack.endpoints).join(", ")}`);
    }
    // Resolved before the guard below reads it and before anything is launched, by the same rule the
    // runner uses: `--as` takes the name `action run` takes, and a guard reading the typed name while
    // the run reads the resolved one is two readers disagreeing about which action this is.
    const as = opts.as ? resolveAction(system.config.actions ?? {}, opts.as) : undefined;
    // The only shape of action this refuses, and the same thing `check drift` says about one:
    // `records: "terminal"` means the steps are typed at a shell, so there is no page for the crawl to
    // inherit however useful what the action does would be. Said before a browser is launched, rather
    // than after thirty seconds of waiting for a locator that will never exist.
    if (as && system.config.actions?.[as]?.records === "terminal") {
      throw new Error(`${as} records a terminal, so it has no screen to leave the crawl on — --as takes an action with a screen, whatever that action does`);
    }

    const browser = await requirePlaywright("exploring an app").chromium.launch({ headless: process.env.HEADED !== "1" });
    const cookies = identityCookies(system.config.identities);
    const requests: SeenRequest[] = [];
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      if (cookies.length) await context.addCookies(cookies);
      const page = await context.newPage();
      // Run first, on the page the crawl then walks with — a session is a cookie jar on the context
      // and an upload is a row on the server, so whatever the action leaves behind is what every
      // later navigation carries.
      if (as) {
        if (!system.run) throw new Error(`this system cannot run actions, so --as=${as} has nothing to drive`);
        await system.run(as, page, {}, { quiet: true });
      }
      // The API half, for free. Every call the app makes while being walked is a declared operation
      // waiting to be named, and a description needs those as much as it needs the screens.
      //
      // Attached after the action, not before: whatever `--as` ran makes its own calls, and those
      // belong to an action that is already described — folding them in would make `operations`
      // differ depending on whether `--as` was passed.
      page.on("request", request => {
        const type = request.resourceType();
        if (type === "xhr" || type === "fetch") requests.push({ method: request.method(), url: request.url() });
      });

      return await Explore.crawl({
        origin,
        from: Explore.startingRoutes(system.config, service),
        maxPages: opts.maxPages ?? 12,
        maxDepth: opts.maxDepth ?? 2,
        requests,
        read: async url => {
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
            // The document is not the app. A client-rendered one is an empty shell when the document
            // is done — Grafana was 4 nodes and no links there, and 32 nodes with links once it had
            // settled — so reading immediately described the shell. Waiting for a THING rather than a
            // time, and a timeout rather than a failure: an app that never goes idle still gets read,
            // it is just read late.
            await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
            // The URL that ended up in the bar, not the one asked for — what the crawl needs to know
            // whether the navigation stayed here.
            return { ...(await Explore.readPage(page, new URL(origin))), url: page.url() };
          } catch {
            return undefined;
          }
        },
      });
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * One page, as facts.
   *
   * Two sources, each used for what it actually knows: the accessibility tree for what a person can
   * see and name, and the DOM for the fields — because a config's `forms` finds an input BY
   * PLACEHOLDER, and an accessible name is the label whenever there is one.
   *
   * A field is found by BEING one. This asked for `input[placeholder], textarea[placeholder]`, so an
   * input with no placeholder attribute was invisible however well labelled — and labelling an input
   * without a placeholder is the more accessible choice, which made the tool weakest on exactly the
   * apps that had done the right thing. Two ordinary `name="username"` / `name="password"` login
   * forms produced `"forms": {}`, on apps whose locators came through fine: the crawl saw the page
   * and could not see the fields. Placeholder text is a fashion, not a standard.
   *
   * Three rules on what counts, all of them from real pages in the stack this was measured against:
   * a button or a toggle is not a field to fill (it is already offered as a locator), a field with no
   * box on the screen is a CSRF token or a hidden state field, and where a `form` element exists the
   * fields inside it are the ones somebody meant.
   *
   * Each field comes back as four things rather than two. The placeholder is the right thing to
   * MATCH on and the wrong thing to NAME from: it is example data, and a designer's example data at
   * that. `id` is asked last on purpose — Grafana's login inputs carry `_r_0_` and `_r_1_`, which
   * React writes fresh, so a description named from those would name a different field every render.
   * The label is kept because a field with no placeholder is filled by `fillFields`, which matches on
   * it; `password` because a page carrying one is how a crawl knows it never got past the front door.
   */
  static async readPage(page: Page, origin: URL): Promise<Omit<PageFacts, "path">> {
    const nodes = Explore.parse(await page.ariaSnapshot());
    const fields = await page.$$eval("input, textarea, select", found => {
      const notAField = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file"]);
      const anyInAForm = found.some(el => el.closest("form"));
      return found
        .filter(el => !notAField.has((el.getAttribute("type") ?? "").toLowerCase()))
        .filter(el => el.getClientRects().length > 0)
        .filter(el => !anyInAForm || el.closest("form"))
        .map(el => {
          const input = el as HTMLInputElement;
          const label = input.labels?.[0]?.textContent?.trim() ?? "";
          const placeholder = input.getAttribute("placeholder") ?? "";
          return {
            placeholder,
            label,
            password: (input.getAttribute("type") ?? "").toLowerCase() === "password",
            name: input.getAttribute("name") || input.getAttribute("aria-label") || label || input.id || placeholder,
          };
        })
        .filter(field => field.name);
    });
    return { nodes, fields, links: Explore.links(nodes, origin), title: Explore.title(nodes) };
  }

  /**
   * An aria snapshot, as a flat list of nodes that remember their depth.
   *
   * Flat rather than a tree because everything downstream asks "which nodes are there", not "what
   * contains what". A line this does not recognise is skipped rather than thrown over: the format
   * grows a shape per Playwright release, and a config generator is not worth failing over one.
   */
  static parse(yaml: string): AriaNode[] {
    const nodes: AriaNode[] = [];
    for (const line of yaml.split("\n")) {
      const match = /^(\s*)- (\/url|[a-z][a-z-]*)(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s+\[([^\]]*)\])?\s*:?\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, indent, role, name, attrs, rest] = match;
      nodes.push({
        depth: Math.floor(indent.length / 2),
        role,
        name: name === undefined ? undefined : name.replace(/\\(.)/g, "$1"),
        attrs: attrs || undefined,
        value: rest || undefined,
      });
    }
    return nodes;
  }

  /** Same-origin paths this page links to — the queue for the next round. */
  static links(nodes: AriaNode[], origin: URL): string[] {
    const out: string[] = [];
    for (const node of nodes) {
      if (node.role !== "/url" || !node.value) continue;
      const path = Explore.samePath(node.value, origin);
      if (path && !out.includes(path)) out.push(path);
    }
    return out;
  }

  /** What this page calls itself: the `main` region's name, or the first heading. */
  static title(nodes: AriaNode[]): string | undefined {
    return (
      nodes.find(node => node.role === "main" && node.name)?.name ?? nodes.find(node => node.role === "heading" && node.name)?.name
    );
  }

  /**
   * Routes: every link's destination, named for the link.
   *
   * The words a person clicks are the words the route should have — that is what makes a `goto` read
   * as a path through the product. A link whose text is a whole sentence ("Already have an account?
   * Sign in now!") makes a terrible identifier, so past a length the path names it instead.
   */
  static routes(pages: PageFacts[]): Record<string, string> {
    const byPath = new Map<string, string>();
    for (const page of pages) {
      const own = Explore.templated(page.path);
      if (!byPath.has(own)) byPath.set(own, Explore.pageName(page));
      for (let i = 0; i < page.nodes.length; i += 1) {
        const node = page.nodes[i];
        if (node.role !== "/url" || !node.value) continue;
        const path = Explore.pathOnly(node.value);
        if (!page.links.includes(path)) continue;
        const route = Explore.templated(path);
        // The link a `/url` belongs to is the nearest node above it that is shallower — and its
        // words only name the route when the route is a screen rather than a row.
        const named = Explore.name(
          route.includes("{") ? "" : Explore.label(Explore.owner(page.nodes, i), node.value),
          Explore.spelled(route),
        );
        const existing = byPath.get(route);
        if (existing === undefined || named.length < existing.length) byPath.set(route, named);
      }
    }
    const routes: Record<string, string> = {};
    for (const [path, name] of [...byPath].sort((a, b) => a[1].localeCompare(b[1]))) {
      routes[Explore.unique(routes, name || "root")] = path;
    }
    return routes;
  }

  /**
   * Locators: the things a step would assert on.
   *
   * Buttons and headings, plus anything interactive that is not a link — links are already routes,
   * and naming each one twice would double a fragment nobody would then read. Only where the role
   * and name are unique on their page: a locator that matches twice is not one, and offering it as
   * one is how a generated description quietly becomes a source of flakes.
   */
  static locators(pages: PageFacts[]): Record<string, LocatorSpec> {
    const out: Record<string, LocatorSpec> = {};
    const already = new Set<string>();
    for (const page of pages) {
      // Counted on the STEADY name, because that is the one being offered: two tabs reading
      // "Inbox 1" and "Inbox 25" are one locator that matches twice, and it is the emitted spec that
      // has to be unique rather than whatever the app rendered this minute.
      const counts = new Map<string, number>();
      for (const node of page.nodes) {
        const steady = node.name && Explore.steady(node.name);
        if (steady) counts.set(`${node.role} ${steady}`, (counts.get(`${node.role} ${steady}`) ?? 0) + 1);
      }
      for (const node of page.nodes) {
        if (!node.name || !Explore.worth.has(node.role)) continue;
        const steady = Explore.steady(node.name);
        const key = `${node.role} ${steady}`;
        if (!steady || counts.get(key) !== 1 || already.has(key)) continue;
        const name = Explore.name(steady, "");
        if (!name) continue;
        already.add(key);
        out[Explore.unique(out, name)] = { role: node.role, name: steady };
      }
    }
    return out;
  }

  /**
   * Forms: the placeholders that find the inputs, grouped by the page they were found on.
   *
   * Named from what the field IS and valued with what FINDS it, which are two different strings.
   * Naming from the placeholder called an email box `youOrganisationCh` and a name box `adaLovelace`
   * — the sample values a designer had typed into a mock, on a real application's real signup form.
   */
  static forms(pages: PageFacts[]): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    const already = new Set<string>();
    for (const page of pages) {
      if (!page.fields.length) continue;
      const fields: Record<string, string> = {};
      for (const field of page.fields) {
        if (!Explore.matchable(field)) continue;
        const name = Explore.name(field.name, "") || Explore.name(field.placeholder, "");
        if (name) fields[Explore.unique(fields, name)] = field.placeholder;
      }
      if (!Object.keys(fields).length) continue;
      // The same form found on three routes is one form. The rule that stops a name collision from
      // silently dropping an entry cannot tell a collision from a repeat, so one sign-in box seen on
      // three pages arrived as `welcomeBack`, `welcomeBack2` and `welcomeBack3`.
      const shape = JSON.stringify(fields);
      if (already.has(shape)) continue;
      already.add(shape);
      out[Explore.unique(out, Explore.pageName(page) || "form")] = fields;
    }
    return out;
  }

  /**
   * The fields `forms` cannot offer, and where they are.
   *
   * `forms` is consumed with `getByPlaceholder`, so a field with no placeholder attribute cannot go
   * in it — but it is still a field, and a fragment that just leaves it out is the bug this replaced
   * wearing better clothes. Named here with its LABEL, because the honest answer for one of these is
   * a `fillFields` step and a label is what that matches on.
   *
   * Deduplicated across pages the same way `forms` is: one sign-in box seen on three routes is one
   * form, and saying so three times is how a generated block stops being read.
   */
  static unfillable(pages: PageFacts[]): string[] {
    const byShape = new Map<string, string>();
    for (const page of pages) {
      const without = [
        ...new Set(page.fields.filter(field => !Explore.matchable(field)).map(field => Explore.readable(field.label || field.name))),
      ];
      if (!without.length) continue;
      const shape = without.join(", ");
      if (!byShape.has(shape)) byShape.set(shape, `${Explore.templated(page.path)} — ${shape}`);
    }
    return [...byShape.values()];
  }

  /**
   * Can `forms` carry this field at all? Only if there is a placeholder to match it by.
   *
   * One predicate with two callers rather than a rule each, because {@link forms} and
   * {@link unfillable} split every field between them and a rule only half of them got would drop a
   * field out of both. Whitespace does not count: linkding's tag box carries `placeholder=" "`, and
   * `getByPlaceholder(" ")` is not a locator — it went into a fragment as `"tagString": " "`, which
   * reads as a described field and resolves to whatever the page happens to have.
   */
  private static matchable(field: PageFacts["fields"][number]): boolean {
    return Boolean(field.placeholder.trim());
  }

  /**
   * A label as one line of a comment.
   *
   * Django's admin puts a whole `<select>`'s option list inside its label, so linkding's real one is
   * `Action: ⏎⏎ --------- ⏎⏎ Delete selected feed tokens` — which broke OUT of the `//` block and
   * left a fragment nobody could paste. Cut at a word, because `fillFields` matches an exact label
   * first and then a PREFIX, so a shortened one still finds the field; a label cut mid-word does not.
   */
  private static readable(text: string, limit = 48): string {
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat.length <= limit) return flat;
    const cut = flat.slice(0, limit);
    return `${cut.slice(0, cut.lastIndexOf(" ") + 1 || limit).trim()}…`;
  }

  /**
   * Operations: the calls the app made while being walked.
   *
   * Paths that differ in one segment are one operation with a parameter, which is what turns eleven
   * observed URLs back into the single declared route they came from. The parameter is called `{id}`
   * because that is nearly always what it is, and renaming one word is less work than finding eleven.
   */
  static operations(requests: SeenRequest[]): Record<string, { method: string; path: string }> {
    const seen = new Map<string, { method: string; path: string }>();
    for (const request of requests) {
      let path: string;
      try {
        path = new URL(request.url).pathname;
      } catch {
        continue;
      }
      // An asset fetched with `fetch()` is still an asset. Grafana loads its icons that way, so the
      // first fragment that got far enough to collect any operations at all offered four SVGs as the
      // API — and a generated block whose every entry has to be deleted is one nobody reads.
      if (/\.(svg|png|jpe?g|gif|webp|ico|woff2?|css|js|mjs|map)$/i.test(path)) continue;
      const templated = Explore.templated(path);
      const key = `${request.method} ${templated}`;
      if (!seen.has(key)) seen.set(key, { method: request.method, path: templated });
    }

    const out: Record<string, { method: string; path: string }> = {};
    for (const [, operation] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
      const parts = operation.path
        .split("/")
        .filter(segment => segment && segment !== "api" && !/^v\d+$/.test(segment))
        .map(segment => (segment === "{id}" ? "byId" : Explore.name(segment, "")))
        .filter(Boolean);
      const base = parts.join(".") || "root";
      // The method only enters the name when it has to. `user.repos` reads better than
      // `user.repos.get`, and a POST to the same path still needs somewhere else to live.
      out[Explore.unique(out, operation.method === "GET" ? base : `${base}.${operation.method.toLowerCase()}`)] = operation;
    }
    return out;
  }

  /**
   * The fragment, as JSONC a person can paste into the file they already have.
   *
   * `as` is only for the notes: what to say to somebody who has not run anything first is not what to
   * say to somebody whose action ran and left the app somewhere else, and telling a reader to do the
   * thing they just did is how a note gets learned as noise.
   */
  static render(found: Discovery, service: string, as?: string): string {
    const block = {
      services: {
        [service]: {
          app: { routes: found.routes, locators: found.locators, forms: found.forms },
          ...(Object.keys(found.operations).length ? { api: { operations: found.operations } } : {}),
        },
      },
    };
    return [
      `// What ${service} says about itself, read off the running app.`,
      "//",
      `// Walked ${found.visited.length} page${found.visited.length === 1 ? "" : "s"}: ${found.visited.join(", ")}`,
      // `Walked 1 page` reads as "this app is small". For an app whose value is entirely behind a
      // login it means "I could not get in", and those are opposite facts about the same number.
      ...(found.behindSignIn
        ? [
            "//",
            "// Every page walked has a password field on it, so this describes the front door and not the",
            "// product. What is behind the login is the part worth describing.",
            ...(as
              ? [
                  `// It ran \`${as}\` first and still landed here, so that action did not leave the app where the`,
                  `// crawl needed it — not signing THIS service in is the commonest way for that to happen.`,
                ]
              : [`// Run a declared sign-in first and the crawl carries the session it leaves:`, `//   config explore ${service} --as=<action>`]),
          ]
        : []),
      ...(found.unfillable.length
        ? [
            "//",
            "// Fields with no placeholder, which `forms` cannot carry — it is matched with getByPlaceholder:",
            ...found.unfillable.map(where => `//   ${where}`),
            "// Fill those with a `fillFields` step, which matches by label.",
          ]
        : []),
      ...(found.empty.length
        ? [
            "//",
            `// Nothing to do on: ${found.empty.join(", ")}`,
            "// No link to follow and nothing a step could click or type into. A page like this is nearly",
            "// always one that had not finished rendering, or one behind a sign-in this config declares",
            "// no identity for — it is almost never a page with nothing on it. HEADED=1 shows you which.",
          ]
        : []),
      ...(found.skipped.length ? ["//", "// Not walked:", ...found.skipped.map(why => `//   ${why}`)] : []),
      "//",
      "// None of this is final, and none of it has been written anywhere. The names come from what the",
      "// app calls things, which is a starting point rather than a decision: rename them to what YOUR",
      "// product calls them, delete the two thirds no action will ever reach, and merge the rest by hand.",
      "",
      JSON.stringify(block, null, 2),
      "",
    ].join("\n");
  }

  /** A path on this origin, or nothing — an off-site link is somebody else's app. */
  private static samePath(href: string, origin: URL): string | undefined {
    try {
      const url = new URL(href, origin);
      if (url.origin !== origin.origin) return undefined;
      // The query is state, not a route: `/user/login?redirect_to=%2f…` is the login screen.
      return Explore.plausible(url.pathname) ? url.pathname : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Is this a path somebody meant, or something that fell out of the markup?
   *
   * `new URL()` accepts anything, so a stray quote in an `href` on a real page became the route
   * `/%22`, and a template rendering an id it did not have became `/view/false` — both harvested,
   * named, walked, and written into a description with nothing between them and the file. Two rules,
   * both from pages in this stack: characters no href should contain, and a last segment that is a
   * JavaScript value somebody printed rather than a word.
   */
  private static plausible(path: string): boolean {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return false;
    }
    if (/["'<>`\\\s]/.test(decoded)) return false;
    const last = decoded.split("/").filter(Boolean).pop();
    return !last || !Explore.printed.has(last.toLowerCase());
  }

  /** What a template prints where an id should have been. */
  private static readonly printed = new Set(["true", "false", "null", "undefined", "nan"]);

  /** The origin a navigation ended up on, when that is not this one — otherwise nothing. */
  private static elsewhere(landed: string, origin: URL): string | undefined {
    try {
      const url = new URL(landed);
      return url.origin === origin.origin ? undefined : url.origin;
    } catch {
      return undefined;
    }
  }

  private static pathOnly(href: string): string {
    return href.split("?")[0].split("#")[0];
  }

  /**
   * A path with its moving parts named rather than baked in: `/view/m8Ms2n2xDXX2JUyFCX8v5E` becomes
   * `/view/{id}`.
   *
   * One function with two callers, because it was written for {@link operations} and {@link routes}
   * never got it — so one fragment folded eleven observed API calls back into the single declared
   * operation they came from while, four lines above, writing down a route to one message that will
   * be gone tomorrow. What makes `{id}` right for a request path makes it right for a screen's: the
   * screen is what lasts, and a description is meant to be committed.
   */
  static templated(path: string): string {
    return path
      .split("/")
      .map(segment => (Explore.value(segment) ? "{id}" : segment))
      .join("/");
  }

  /**
   * A segment that is a value rather than a word.
   *
   * Digits and UUIDs were all this knew, which is why Mailpit's `m8Ms2n2xDXX2JUyFCX8v5E` went
   * through untouched — most id schemes are neither. The third rule is for those: long, mixing
   * letters with digits, and unbroken by the hyphen or dot a slug somebody wrote would have.
   */
  private static value(segment: string): boolean {
    if (/^\d+$/.test(segment)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return true;
    return segment.length >= 12 && /\d/.test(segment) && /[A-Za-z]/.test(segment) && !/[-.]/.test(segment);
  }

  /** A templated path with its parameters taken out, so `/view/{id}` reads as `view` and not `viewId`. */
  private static spelled(route: string): string {
    return route
      .split("/")
      .filter(segment => !segment.startsWith("{"))
      .join("/");
  }

  /**
   * What to call a page: what it calls itself, unless what it calls itself is one row's data.
   *
   * A path with a parameter in it IS a row — the message, that repository — so its heading is the
   * subject of whichever one happened to be open. `/view/{id}` describes the screen forever;
   * "Recover your account" describes an email somebody will delete.
   */
  private static pageName(page: PageFacts): string {
    const route = Explore.templated(page.path);
    return Explore.name(route.includes("{") ? "" : (page.title ?? ""), Explore.spelled(route));
  }

  /**
   * A name with the moving parts taken out: `HTML Check 95%` is `HTML Check`, `Inbox 1` is `Inbox`.
   *
   * Two runs of the same command against an unchanged Mailpit disagreed by three locators, all of
   * them named after a number the app had rendered. `htmlCheck95` also stops RESOLVING the moment
   * the score is not 95, so the stable part replaces the name as well as naming it — locators match
   * by substring, and "HTML Check" finds the tab whatever it scored. A name that is nothing but its
   * number has no stable part and is dropped: an ambiguous locator is already dropped, and a
   * volatile one is worse than ambiguous.
   */
  static steady(text: string): string {
    return text
      .split(/\s+/)
      .filter(word => !/\d/.test(word) || /[A-Za-z]/.test(word.replace(/[^A-Za-z0-9]/g, "")))
      .join(" ")
      .trim();
  }

  /**
   * A link's words, unless those words are the thing being linked TO.
   *
   * `gitea@witness.example` pointing at `/search?q=gitea%40witness.example` is a row of data wearing
   * a link, and it named Mailpit's search screen after whoever sent the last message. A nav link
   * whose text is in its PATH — "Explore" for `/explore/repos` — is the opposite and the good case,
   * which is why this asks only about the query.
   */
  private static label(owner: AriaNode | undefined, href: string): string {
    const name = owner?.name;
    if (!name) return "";
    const query = href.split("?")[1];
    if (!query) return name;
    let decoded: string;
    try {
      decoded = decodeURIComponent(query);
    } catch {
      decoded = query;
    }
    return decoded.toLowerCase().includes(name.toLowerCase()) ? "" : name;
  }

  /** The node a `/url` belongs to: the nearest one above it that is shallower. */
  private static owner(nodes: AriaNode[], index: number): AriaNode | undefined {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (nodes[i].depth < nodes[index].depth) return nodes[i];
    }
    return undefined;
  }

  /**
   * What a person would type: `Sign In` becomes `signIn`, and a sentence becomes the path it points at.
   *
   * Two rules learned from the first fragment this produced against a real app. A name has to START
   * WITH A LETTER — a link whose text is a star count gave routes called `0` and `02`, which are not
   * identifiers and not readable either. And a name too long to keep is cut at a WORD, because
   * `aPainlessSelfHostedGitSe` is worse than the truncation being visible.
   */
  static name(text: string, fallbackPath: string, limit = 24): string {
    const words = (value: string): string[] =>
      value
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean);
    const camel = (parts: string[]): string =>
      parts.map((word, i) => (i === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase())).join("");

    const useful = (name: string): boolean => /^[A-Za-z]/.test(name);
    const fromText = camel(words(text));
    // Long enough to be a sentence rather than a label. A route called
    // `alreadyHaveAnAccountSignInNow` is worse than one called `userLogin`.
    if (useful(fromText) && fromText.length <= limit) return fromText;

    const fromPath = camel(words(fallbackPath));
    if (useful(fromPath) && fromPath.length <= limit) return fromPath;

    // Whole words only, from whichever source had any.
    const parts = useful(fromText) ? words(text) : useful(fromPath) ? words(fallbackPath) : [];
    const kept: string[] = [];
    for (const word of parts) {
      if (kept.length && camel([...kept, word]).length > limit) break;
      kept.push(word);
    }
    return camel(kept);
  }

  /** `signIn`, `signIn2`, `signIn3` — a collision is renamed, never silently dropped. */
  private static unique(taken: Record<string, unknown>, name: string): string {
    if (!(name in taken)) return name;
    for (let n = 2; ; n += 1) if (!(`${name}${n}` in taken)) return `${name}${n}`;
  }
}

export type AriaNode = { depth: number; role: string; name?: string; attrs?: string; value?: string };
export type SeenRequest = { method: string; url: string };
export type PageFacts = {
  path: string;
  nodes: AriaNode[];
  /**
   * One per fillable field on the page: what it is called, the placeholder that finds it (empty when
   * it has none), the label a `fillFields` step would match on, and whether it is a password box.
   */
  fields: { name: string; placeholder: string; label: string; password: boolean }[];
  links: string[];
  title?: string;
  /** Where the read actually landed. Absent when nothing navigated — a fixture, or a page read in place. */
  url?: string;
};

export type CrawlInput = {
  origin: string;
  /** Where to start. The routes already declared, when there are any. */
  from?: string[];
  maxPages: number;
  maxDepth: number;
  requests?: SeenRequest[];
  read: (url: string) => Promise<Omit<PageFacts, "path"> | undefined>;
};

export type Discovery = {
  routes: Record<string, string>;
  locators: Record<string, LocatorSpec>;
  forms: Record<string, Record<string, string>>;
  /** Fields a `forms` block cannot carry, because they have no placeholder to match on. */
  unfillable: string[];
  operations: Record<string, { method: string; path: string }>;
  visited: string[];
  /** What the caps left out, said out loud. */
  skipped: string[];
  /** Walked, and offered nothing — the case that used to be indistinguishable from a simple app. */
  empty: string[];
  /** Every page walked wanted a password: the other case a small `visited` list can mean. */
  behindSignIn: boolean;
};

export type ExplorableSystem = {
  stack: { endpoints: Record<string, string> };
  config: {
    identities?: Parameters<typeof identityCookies>[0];
    /** Where a screen is declared by the time anything reads a config: a service's `app` is hoisted here. */
    apps?: Record<string, { service?: string; routes?: Record<string, string> }>;
    services?: Record<string, unknown>;
    /** Asked which action `--as` names, and then whether that one has a screen to leave the crawl on. */
    actions?: Record<string, { records?: string }>;
  };
  /** How the action `--as` names gets driven, whatever it does. The same signature `check drift` asks for. */
  run?: (action: string, page: Page, inputs: Params, within?: { quiet?: boolean }) => Promise<unknown>;
};
