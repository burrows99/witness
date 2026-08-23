import type { Page } from "@playwright/test";

import { describe, type LocatorSpec, locate } from "../browser/locator.ts";
import type { ActionConfig, Params, StepConfig } from "../actions/engine.ts";
import type { IdentityConfig } from "../config/schema.ts";
import { identityCookies } from "../browser/identities.ts";
import { requirePlaywright } from "../browser/playwright.ts";

/**
 * Whether the description still describes the thing.
 *
 * A locator does not announce that it stopped resolving. It waits until a run reaches that step, times
 * out, and fails — telling you about exactly ONE of them, thirty seconds later. Fix it, run again, and
 * buy the next. A description that drifted in six places costs six runs to discover.
 *
 * The first version of this swept every declared locator across every declared route. On a description
 * written for Grafana 13.2 running against 10.4 it correctly found all eight breakages in 21 seconds,
 * where a run had found one in 47 — and then, run against the version the description was WRITTEN for,
 * it reported eight more, six of which were false:
 *
 *   - `connectionCard` matched 226 elements, which is the entire point of the `store` that uses it
 *   - `usersTable` matched twice on a route no step ever uses it on
 *   - `Skip` matched nothing, because it only exists after a click and a URL sweep cannot get there
 *
 * A checker that cries wolf is worse than no checker: the first false positive teaches everyone to
 * ignore the true ones. So this does not sweep. It reads the CLAIMS the description already makes —
 * an action's steps say which route they are on and what they expect to find there — and verifies
 * exactly those, which is the only thing that can be judged without guessing.
 */
export class Drift {
  /**
   * The same check, driven against a whole system.
   *
   * Opening a browser, carrying the identities, resolving a route: all of it is the system's own
   * knowledge, and none of it is the composite root's job to spell out a second time.
   */
  static async sweep(system: SweepableSystem, as?: string): Promise<Report> {
    // The argument names the action that SIGNS IN, and a terminal action has no screen to sign in on.
    // Driven anyway it opened a browser, waited thirty seconds for `locator('prompt')`, and reported
    // the action as broken — a red about the checker being pointed at the wrong thing, wearing the
    // words of a red about the description. Said here, before anything is launched.
    if (as && system.config.actions?.[as]?.records === "terminal")
      throw new Error(`${as} records a terminal, so it has no screen to sign a browser in on — \`check drift\` takes the action that signs in, and terminal actions are skipped by this check`);
    const browser = await requirePlaywright("checking the description").chromium.launch({ headless: process.env.HEADED !== "1" });
  const cookies = identityCookies(system.config.identities);
  try {
    const report = await Drift.check({
      actions: system.config.actions ?? {},
      // The same resolution a `goto` step does, so a claim is checked at the URL the step goes to.
      routeOf: (app, route) => {
        try {
          // A route with parameters cannot be visited without values, so it is left unchecked
          // rather than fetched with `{orderId}` still in the path.
          return app ? system.routeUrl(app, route) : undefined;
        } catch {
          return undefined;
        }
      },
      page: async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        if (cookies.length) await context.addCookies(cookies);
        return context.newPage();
      },
      // Quiet: this is a read-only check, and it used to leave a whole `cli/adhoc/run/actions/`
      // tree of frames and stories behind from the sign-in it drives to get in.
      signIn: as ? async (page: Page) => void (await system.run(as, page, {}, { quiet: true })) : undefined,
      signInAction: as,
    });
    return report;
  } finally {
    await browser.close().catch(() => undefined);
  }
  }

  static async check(input: CheckInput): Promise<Report> {
    // An action with no screen is not this checker's to check. Its steps type at a shell, so there is
    // no route to visit and no locator to count — and a browser driven at one waits out a timeout on
    // a locator that will never exist. Left out, and SAID: a report that quietly read half a
    // description and answered "all claims still hold" is the same lie as one that cries wolf.
    const onScreen = Object.entries(input.actions).filter(([, action]) => action.records !== "terminal");
    const skipped = Object.keys(input.actions).length - onScreen.length;
    const claims = Drift.claims(Object.fromEntries(onScreen), input.routeOf, input.signInAction);
    const findings: Finding[] = [];

    // Grouped, because the cost is the navigation and several claims usually share a route.
    const byRoute = new Map<string, Claim[]>();
    for (const claim of claims) byRoute.set(claim.url, [...(byRoute.get(claim.url) ?? []), claim]);

    for (const [needsSignIn, group] of [
      [false, [...byRoute].filter(([, of]) => of.every(claim => claim.signedOut))],
      [true, [...byRoute].filter(([, of]) => of.some(claim => !claim.signedOut))],
    ] as const) {
      if (!group.length) continue;
      // The sign-in action's own steps are checked signed OUT — a login form is unreachable once you
      // are in, and checking it from a signed-in page reports the working fields as gone.
      const page = await input.page();
      try {
        // Without a named sign-in there is only one pass, on a plain page. What that cannot reach
        // announces itself below by redirecting, which is a fact rather than an assumption.
        if (needsSignIn && input.signIn) await input.signIn(page);
        for (const [url, of] of group) {
          const { status, landed } = await Drift.visit(page, url);
          if (status >= 400 || status === 0) {
            findings.push({ ...of[0].where, kind: "route", verdict: "unreachable", detail: status ? `${url} answered ${status}` : `nothing answered at ${url}` });
            continue;
          }
          // Somewhere else is where an app puts you when you may not be here. Every locator on the
          // screen you asked for would come back as gone, and every one of those would be a lie.
          if (landed && new URL(landed).pathname !== new URL(url).pathname) {
            findings.push({
              ...of[0].where,
              kind: "route",
              verdict: "unchecked",
              detail: `${url} sent us to ${landed}${input.signIn ? "" : " — name an action that signs in, and this can be checked"}`,
            });
            continue;
          }
          for (const claim of of) {
            const count = await locate(page, claim.spec)
              .count()
              .catch(() => 0);
            if (count === 0 && claim.some) findings.push({ ...claim.where, verdict: "gone", detail: `${describe(claim.spec)} — nothing matches it on ${claim.route}` });
            // More than one is only wrong where the step wanted one. A `store` reading a list wants
            // every match, and calling that ambiguous is how a checker teaches people to ignore it.
            else if (count > 1 && claim.one) findings.push({ ...claim.where, verdict: "ambiguous", detail: `${describe(claim.spec)} — ${count} matches on ${claim.route}, and this step needs one` });
          }
        }
      } finally {
        await page.context().close().catch(() => undefined);
      }
    }

    const broken = findings.filter(finding => finding.verdict !== "unchecked");
    const headline = broken.length
      ? `${broken.length} of ${claims.length} claims no longer hold`
      : `all ${claims.length} claims still hold${findings.length ? ` (${findings.length} could not be checked)` : ""}`;
    return {
      ok: !broken.length,
      findings,
      checked: claims.length,
      skipped,
      summary: skipped ? `${headline} · ${skipped} terminal action${skipped === 1 ? "" : "s"} skipped, having no screen to check` : headline,
    };
  }

  /**
   * What the description claims, read off the actions rather than the locator list.
   *
   * A claim is a locator AND the route a step is on when it uses it — the pair, because "this matches
   * something somewhere" is not what any step depends on.
   *
   * Only while the page is where a `goto` put it: after a click, a fill or a keypress the app is
   * somewhere no URL can reproduce, and a locator that lives on the other side of a button (a
   * password-change interstitial, a dialog, a menu) would otherwise be reported as gone forever.
   */
  private static claims(actions: Record<string, ActionConfig>, routeOf: (app: string | undefined, route: string) => string | undefined, signIn?: string): Claim[] {
    const claims: Claim[] = [];
    // Which actions run before anyone is signed in: the sign-in action itself, and whatever it is
    // built from. Their claims are checked signed OUT — a login form is unreachable once you are in,
    // and checking it from a signed-in page reports the very fields that just worked as gone.
    const beforeSignIn = new Set<string>();
    const mark = (name: string): void => {
      if (!name || beforeSignIn.has(name)) return;
      beforeSignIn.add(name);
      for (const step of actions[name]?.steps ?? []) {
        if (step.run) mark(typeof step.run === "string" ? step.run : step.run.action);
      }
    };
    if (signIn) mark(signIn);

    const walk = (name: string, action: ActionConfig): void => {
      const signedOut = beforeSignIn.has(name);
      let at: { route: string; url: string } | undefined;
      for (const step of action.steps ?? []) {
        if (step.goto) {
          const url = step.goto.url ?? (step.goto.route ? routeOf(step.goto.app ?? action.app, step.goto.route) : undefined);
          at = url ? { route: step.goto.route ?? url, url } : undefined;
          continue;
        }
        // Not followed: the composed action is walked on its own turn, and following it here
        // collected every one of its claims twice. Where the page ends up afterwards is unknowable
        // from here, so this stops claiming anything until the next `goto`.
        if (step.run) {
          at = undefined;
          continue;
        }
        // Anything that changes the page takes it somewhere a URL cannot put it back.
        if (step.click || step.press || step.fill || step.type || step.fillFields || step.reload || step.waitForUrl) {
          const target = step.click ?? step.type?.on ?? step.fill?.on;
          if (at && target) claims.push({ ...at, spec: target, one: true, some: true, signedOut, where: { kind: "locator", action: name, step: Drift.label(step) } });
          at = undefined;
          continue;
        }
        if (!at) continue;
        if (step.expect) {
          // `count` says how many are expected, so more than one is the claim rather than a problem —
          // and `count: 0` is a claim that it is NOT there.
          claims.push({ ...at, spec: step.expect.on, one: step.expect.count === undefined, some: step.expect.count !== 0, signedOut, where: { kind: "locator", action: name, step: Drift.label(step) } });
        }
        if (step.store) {
          // A `store` reading a list is entitled to find an empty one — "a fresh install has no
          // dashboards" is the claim half these actions exist to make. Only a single-element `store`
          // is broken by matching nothing.
          claims.push({ ...at, spec: step.store.from, one: !step.store.all, some: !step.store.all, signedOut, where: { kind: "locator", action: name, step: Drift.label(step) } });
        }
      }
    };
    for (const [name, action] of Object.entries(actions)) walk(name, action);
    return claims;
  }

  private static label(step: StepConfig): string {
    return Object.keys(step).find(key => !["note", "as", "within", "fullPage"].includes(key)) ?? "step";
  }

  /** The status, and where the browser actually ended up — which is not always where it was sent. */
  private static async visit(page: Page, url: string): Promise<{ status: number; landed?: string }> {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      // A single-page app finishes routing after the document — including the redirect that decides
      // you may not be here — and what a step looks for arrives with it.
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      return { status: response?.status() ?? 0, landed: page.url() };
    } catch {
      return { status: 0 };
    }
  }

  /** The report as a person reads it. */
  static render(report: Report): string {
    if (report.ok && !report.findings.length) return report.summary;
    const lines = [report.summary, ""];
    for (const [verdict, heading] of [
      ["gone", "Nothing matches these any more — a run will time out on them:"],
      ["ambiguous", "These match more than one thing where the step needs one:"],
      ["unreachable", "A step goes here, and the app does not serve it:"],
      ["unchecked", "Not checked:"],
    ] as const) {
      const of = report.findings.filter(finding => finding.verdict === verdict);
      if (of.length) lines.push(heading, ...of.map(f => `  ${f.action} · ${f.step}  ${f.detail ?? ""}`), "");
    }
    return lines.join("\n");
  }
}

/** The part of a system this needs, so the check does not depend on the whole composite root. */
export type SweepableSystem = {
  config: { actions?: Record<string, ActionConfig>; apps?: Record<string, unknown>; identities?: Record<string, IdentityConfig> };
  routeUrl: (app: string, route: string) => string;
  run: (action: string, page: Page, inputs: Params, within?: { quiet?: boolean }) => Promise<unknown>;
};

export type CheckInput = {
  actions: Record<string, ActionConfig>;
  /** A declared route to a URL, for the app a step is about. */
  routeOf: (app: string | undefined, route: string) => string | undefined;
  /** A page in a fresh context. */
  page: () => Promise<Page>;
  /** How this product signs somebody in — an action, because that is already described. */
  signIn?: (page: Page) => Promise<void>;
  /** Its name, so its own steps are checked before anybody is signed in. */
  signInAction?: string;
};

type Claim = {
  route: string;
  url: string;
  spec: LocatorSpec;
  /** Whether this step needs exactly one match. A `store` reading a list does not. */
  one: boolean;
  /** Whether it needs any at all. A `store` reading a list is entitled to find it empty. */
  some: boolean;
  signedOut: boolean;
  where: { kind: "locator"; action: string; step: string };
};

export type Finding = {
  kind: "locator" | "route";
  action: string;
  step: string;
  verdict: "gone" | "ambiguous" | "unreachable" | "unchecked";
  detail?: string;
};

export type Report = {
  ok: boolean;
  findings: Finding[];
  checked: number;
  /** Actions this could not check: a terminal one has no screen, and its claims are made in a tape. */
  skipped: number;
  summary: string;
};
