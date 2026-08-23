import type { Page } from "@playwright/test";

import { identityCookies } from "../browser/identities.ts";
import { requirePlaywright } from "../browser/playwright.ts";
import type { LocatorSpec } from "../browser/locator.ts";

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
      if (seen.has(next.path)) continue;
      // Marked seen even when it is skipped. Without this a path still in the queue behind several
      // pages was reported once per page that linked to it — three identical lines about
      // `/user/login`, in a list whose whole job is to be read.
      seen.add(next.path);
      if (Explore.handoff.test(next.path)) {
        skipped.push(`${next.path} — hands off to an identity provider; walking it would send a third party a request`);
        continue;
      }
      if (pages.length >= input.maxPages) {
        // Counted and named rather than truncated in silence: a fragment that stopped early looks
        // exactly like one that found everything.
        skipped.push(`${next.path} — past the ${input.maxPages}-page limit`);
        continue;
      }

      const facts = await input.read(new URL(next.path, origin).toString());
      if (!facts) {
        skipped.push(`${next.path} — could not be read`);
        continue;
      }
      // Where a link POINTS is not where it lands, and only the second one is same-origin in any
      // useful sense. A path on this origin that answers 302 defeats a check on the href entirely:
      // the first fragment this produced against an app with social sign-in described Microsoft's
      // login screen — "Email, phone, or Skype" — as the product's own. Judged after the navigation,
      // on the URL that ended up in the bar, and the page dropped rather than read.
      const landed = facts.url ? Explore.elsewhere(facts.url, origin) : undefined;
      if (landed) {
        skipped.push(`${next.path} — left this origin for ${landed}`);
        continue;
      }
      pages.push({ ...facts, path: next.path });
      // A page that offered nothing is reported rather than counted. `Walked 1 page` reads exactly
      // like "your app has one page", and for three apps in seven it meant the opposite.
      if (Explore.barren(facts)) empty.push(next.path);

      if (next.depth >= input.maxDepth) continue;
      for (const link of facts.links) {
        if (!seen.has(link)) queue.push({ path: link, depth: next.depth + 1 });
      }
    }

    return {
      routes: Explore.routes(pages),
      locators: Explore.locators(pages),
      forms: Explore.forms(pages),
      operations: Explore.operations(input.requests ?? []),
      visited: pages.map(page => page.path),
      skipped,
      empty,
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

  /** The same crawl, driven against a whole system — its origin, its identities, its declared routes. */
  static async of(system: ExplorableSystem, service: string, opts: { maxPages?: number; maxDepth?: number } = {}): Promise<Discovery> {
    const origin = system.stack.endpoints[service];
    if (!origin) {
      throw new Error(`no service "${service}" — the config declares: ${Object.keys(system.stack.endpoints).join(", ")}`);
    }

    const browser = await requirePlaywright("exploring an app").chromium.launch({ headless: process.env.HEADED !== "1" });
    const cookies = identityCookies(system.config.identities);
    const requests: SeenRequest[] = [];
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      if (cookies.length) await context.addCookies(cookies);
      const page = await context.newPage();
      // The API half, for free. Every call the app makes while being walked is a declared operation
      // waiting to be named, and a description needs those as much as it needs the screens.
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
   * see and name, and the DOM for placeholder attributes — because a config's `forms` finds an input
   * BY PLACEHOLDER, and an accessible name is the label whenever there is one.
   */
  static async readPage(page: Page, origin: URL): Promise<Omit<PageFacts, "path">> {
    const nodes = Explore.parse(await page.ariaSnapshot());
    const placeholders = await page.$$eval("input[placeholder], textarea[placeholder]", found =>
      found.map(el => (el as HTMLInputElement).placeholder).filter(Boolean),
    );
    return { nodes, placeholders, links: Explore.links(nodes, origin), title: Explore.title(nodes) };
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
      if (!byPath.has(page.path)) byPath.set(page.path, Explore.name(page.title ?? "", page.path));
      for (let i = 0; i < page.nodes.length; i += 1) {
        const node = page.nodes[i];
        if (node.role !== "/url" || !node.value) continue;
        const path = Explore.pathOnly(node.value);
        if (!page.links.includes(path)) continue;
        // The link a `/url` belongs to is the nearest node above it that is shallower.
        const named = Explore.name(Explore.owner(page.nodes, i)?.name ?? "", path);
        const existing = byPath.get(path);
        if (existing === undefined || named.length < existing.length) byPath.set(path, named);
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
      const counts = new Map<string, number>();
      for (const node of page.nodes) {
        if (node.name) counts.set(`${node.role} ${node.name}`, (counts.get(`${node.role} ${node.name}`) ?? 0) + 1);
      }
      for (const node of page.nodes) {
        if (!node.name || !Explore.worth.has(node.role)) continue;
        const key = `${node.role} ${node.name}`;
        if (counts.get(key) !== 1 || already.has(key)) continue;
        const name = Explore.name(node.name, "");
        if (!name) continue;
        already.add(key);
        out[Explore.unique(out, name)] = { role: node.role, name: node.name };
      }
    }
    return out;
  }

  /** Forms: the placeholders that find the inputs, grouped by the page they were found on. */
  static forms(pages: PageFacts[]): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const page of pages) {
      if (!page.placeholders.length) continue;
      const fields: Record<string, string> = {};
      for (const placeholder of page.placeholders) {
        const field = Explore.name(placeholder, "");
        if (field) fields[Explore.unique(fields, field)] = placeholder;
      }
      if (Object.keys(fields).length) {
        out[Explore.unique(out, Explore.name(page.title ?? "", page.path) || "form")] = fields;
      }
    }
    return out;
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
      const templated = path
        .split("/")
        .map(segment => (/^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) ? "{id}" : segment))
        .join("/");
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

  /** The fragment, as JSONC a person can paste into the file they already have. */
  static render(found: Discovery, service: string): string {
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
      return url.pathname;
    } catch {
      return undefined;
    }
  }

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
  placeholders: string[];
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
  operations: Record<string, { method: string; path: string }>;
  visited: string[];
  /** What the caps left out, said out loud. */
  skipped: string[];
  /** Walked, and offered nothing — the case that used to be indistinguishable from a simple app. */
  empty: string[];
};

export type ExplorableSystem = {
  stack: { endpoints: Record<string, string> };
  config: {
    identities?: Parameters<typeof identityCookies>[0];
    /** Where a screen is declared by the time anything reads a config: a service's `app` is hoisted here. */
    apps?: Record<string, { service?: string; routes?: Record<string, string> }>;
    services?: Record<string, unknown>;
  };
};
