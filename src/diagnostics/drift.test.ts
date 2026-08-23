import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import type { Page } from "@playwright/test";

const havePlaywright = await import("@playwright/test").then(
  () => true,
  () => false,
);
const { Drift } = havePlaywright ? await import("./drift.ts") : ({ Drift: null } as never);
const when = { skip: havePlaywright ? false : "needs @playwright/test" };

/** A page that answers with whatever each URL was said to hold. */
const fakePage = (holds: Record<string, Record<string, number>>) => {
  let at = "";
  const page = {
    url: () => at,
    goto: async (url: string) => ((at = url), { status: () => (holds[url] ? 200 : 404) }),
    waitForLoadState: async () => undefined,
    context: () => ({ close: async () => undefined }),
    getByRole: (role: string, opts?: { name?: unknown }) => count(`role=${role}${opts?.name ? ` name=${String(opts.name)}` : ""}`),
    getByPlaceholder: (value: string) => count(`placeholder=${value}`),
    getByTestId: (value: string) => count(`testId=${value}`),
    getByLabel: (value: string) => count(`label=${value}`),
    getByText: (value: string) => count(`text=${value}`),
    locator: (selector: string) => count(`css=${selector}`),
  };
  const count = (key: string) => ({ count: async () => holds[at]?.[key] ?? 0 });
  return page as unknown as Page;
};

const check = (actions: Record<string, unknown>, holds: Record<string, Record<string, number>>, signIn?: string) =>
  Drift.check({
    actions: actions as never,
    routeOf: (app, route) => (app ? `http://app/${route}` : undefined),
    page: async () => fakePage(holds),
    signIn: signIn ? async () => undefined : undefined,
    signInAction: signIn,
  });

test("it checks what a step claims, on the route the step is on", when, async () => {
  const report = await check(
    { open: { app: "a", steps: [{ goto: { route: "list" } }, { expect: { on: { role: "table" } } }] } },
    { "http://app/list": {} },
  );
  equal(report.checked, 1);
  equal(report.ok, false);
  equal(report.findings[0].verdict, "gone");
});

test("a locator behind a click is not claimed, because no URL can put the page there", when, async () => {
  // `Skip` exists only on the interstitial after a login POST. Reported as gone, it would send
  // somebody rewriting a locator that works — which is what the first version of this did.
  const report = await check(
    {
      signIn: {
        app: "a",
        steps: [
          { goto: { route: "login" } },
          { click: { role: "button", name: "Log in" } },
          { click: { role: "button", name: "Skip" } },
          { expect: { on: { text: "Welcome" } } },
        ],
      },
    },
    { "http://app/login": { "role=button name=/Log in/": 1 } },
  );
  // Only the first click is on ground a `goto` established; everything after it is unknowable.
  equal(report.checked, 1);
  ok(report.ok);
});

test("a store reading a list is entitled to find it empty", when, async () => {
  // "A fresh install has no dashboards" is the claim half these actions exist to make.
  const report = await check(
    { open: { app: "a", steps: [{ goto: { route: "list" } }, { store: { from: { role: "row" }, as: "rows", all: true } }] } },
    { "http://app/list": {} },
  );
  ok(report.ok, Drift.render(report));
});

test("…but a store reading one element is broken by matching nothing", when, async () => {
  const report = await check(
    { open: { app: "a", steps: [{ goto: { route: "list" } }, { store: { from: { role: "row" }, as: "row" } }] } },
    { "http://app/list": {} },
  );
  equal(report.findings[0]?.verdict, "gone");
});

test("more than one match is only wrong where the step needs one", when, async () => {
  const many = { "http://app/list": { "role=row": 226 } };
  const reading = await check({ a: { app: "a", steps: [{ goto: { route: "list" } }, { store: { from: { role: "row" }, as: "all", all: true } }] } }, many);
  ok(reading.ok, "a store reading a list wants every match");
  const counting = await check({ a: { app: "a", steps: [{ goto: { route: "list" } }, { expect: { on: { role: "row" }, count: 226 } }] } }, many);
  ok(counting.ok, "`count` says how many are expected");
  const clicking = await check({ a: { app: "a", steps: [{ goto: { route: "list" } }, { click: { role: "row" } }] } }, many);
  equal(clicking.findings[0]?.verdict, "ambiguous");
});

test("the sign-in action's own steps are checked before anybody is signed in", when, async () => {
  // A login form is unreachable once you are in. Checked from a signed-in page, the fields that just
  // worked come back as gone.
  const report = await check(
    {
      signIn: { app: "a", steps: [{ goto: { route: "login" } }, { type: { on: { placeholder: "email" }, value: "x" } }] },
      other: { app: "a", steps: [{ goto: { route: "home" } }, { expect: { on: { text: "Hello" } } }] },
    },
    { "http://app/login": { "placeholder=email": 1 }, "http://app/home": { "text=Hello": 1 } },
    "signIn",
  );
  ok(report.ok, Drift.render(report));
});

test("a composed action's claims are counted once, not once per composition", when, async () => {
  const report = await check(
    {
      inner: { app: "a", steps: [{ goto: { route: "list" } }, { expect: { on: { role: "table" } } }] },
      outerOne: { app: "a", steps: [{ run: "inner" }] },
      outerTwo: { app: "a", steps: [{ run: "inner" }] },
    },
    { "http://app/list": { "role=table": 1 } },
  );
  equal(report.checked, 1);
});

test("a route the app does not serve is said once, not once per claim", when, async () => {
  const report = await check(
    { a: { app: "a", steps: [{ goto: { route: "gone" } }, { expect: { on: { role: "table" } } }, { expect: { on: { text: "x" } } }] } },
    {},
  );
  equal(report.findings.length, 1);
  equal(report.findings[0].verdict, "unreachable");
});

test("a route that sends us somewhere else is unchecked, not broken", when, async () => {
  // Somewhere else is where an app puts you when you may not be here. Every locator on the screen you
  // asked for would come back as gone, and every one of those would be a lie.
  const holds: Record<string, Record<string, number>> = { "http://app/home": {} };
  const report = await Drift.check({
    actions: { a: { app: "a", steps: [{ goto: { route: "home" } }, { expect: { on: { text: "Hello" } } }] } } as never,
    routeOf: (app, route) => (app ? `http://app/${route}` : undefined),
    page: async () => {
      const page = fakePage(holds) as unknown as { goto: (u: string) => Promise<unknown>; url: () => string };
      const go = page.goto.bind(page);
      page.goto = async (url: string) => {
        const response = await go(url);
        // The app decided we may not be here.
        page.url = () => "http://app/login";
        return response;
      };
      return page as unknown as Page;
    },
  });
  equal(report.findings[0]?.verdict, "unchecked");
  ok(report.findings[0]?.detail?.includes("name an action that signs in"), report.findings[0]?.detail);
  ok(report.ok, "not knowing is not the same as broken");
});
