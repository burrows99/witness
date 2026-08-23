import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import type { Page } from "@playwright/test";

import { asTape } from "../providers/recorders.ts";
import type { SweepableSystem } from "./drift.ts";

const havePlaywright = await import("@playwright/test").then(
  () => true,
  () => false,
);
const { Drift } = havePlaywright ? await import("./drift.ts") : ({} as typeof import("./drift.ts"));
const when = { skip: havePlaywright ? false : "needs @playwright/test" };

/**
 * The package is not the browser. `npm i @playwright/test` downloads nothing — verified against a
 * scratch prefix, because what is on a machine is a result and more than one thing produces it — so a
 * test that LAUNCHES one needs `npx playwright install chromium`, which is why CI now runs it. Skipped
 * rather than failed on a checkout that has not, and CI is the one place nothing may skip.
 */
const executable = havePlaywright ? await import("@playwright/test").then(pw => pw.chromium.executablePath()).catch(() => "") : "";
const withABrowser = {
  skip: !havePlaywright ? "needs @playwright/test" : existsSync(executable) ? false : "needs a browser — npx playwright install chromium",
};

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
    actions: { a: { app: "a", steps: [{ goto: { route: "home" } }, { expect: { on: { text: "Hello" } } }] } },
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

test("an action with no screen that claims nothing has had nothing skipped", when, async () => {
  // It types at a shell: no route to visit, no locator to count, and — these seven steps in this
  // repository's own description being the shape people actually write — no assertion either. Counted
  // as skipped, it reports a silence as an omission, which reads on the board like something to fix.
  const report = await check(
    {
      onScreen: { app: "a", steps: [{ goto: { route: "list" } }, { expect: { on: { role: "table" } } }] },
      atAPrompt: { app: "a", records: "terminal", steps: [{ type: { on: "prompt", value: "psql" } }, { press: "Enter" }] },
    },
    { "http://app/list": { "role=table": 1 } },
  );
  equal(report.checked, 1);
  equal(report.skipped, 0);
  ok(report.ok, Drift.render(report));
  equal(Drift.render(report), report.summary);
});

test("…but one that asserts in a tape is named, with why nothing here can judge it", when, async () => {
  // `expect: { text }` becomes `Wait+Screen /…/`: the same claim, held against the pane by VHS. What
  // it matches exists only once the command has run, so this cannot judge it — and a report that says
  // "all claims still hold" about a description whose other half it never opened is the same lie as
  // one that cries wolf.
  const report = await check(
    { atAPrompt: { app: "a", records: "terminal", steps: [{ type: { on: "prompt", value: "psql -c 'select 1'" } }, { expect: { on: "screen", text: "1 row" } }] } },
    {},
  );
  equal(report.skipped, 1);
  ok(report.ok, "not knowing is not the same as broken");
  const rendered = Drift.render(report);
  ok(rendered.includes("1 claim made in a tape rather than on a screen"), rendered);
  ok(rendered.includes('"1 row" is claimed in a tape as `Wait+Screen`'), rendered);
});

test("an expect a tape cannot carry is asserted by nothing at all, and that can be judged from here", when, async () => {
  // Only `text` reaches a tape. A `state`, a `count` or a bare locator describes a screen a terminal
  // does not have and is dropped by `asTape` — and the engine never runs a terminal action's steps,
  // so nothing else reads it either. No vhs needed to know that: it is the same field, read twice.
  const steps = [{ expect: { on: { role: "table" }, count: 2 } }];
  ok(!asTape(steps, {}, "/tmp/x.mp4").includes("Wait+Screen"), "asTape drops it");
  const report = await check({ atAPrompt: { app: "a", records: "terminal", steps } }, {});
  ok(Drift.render(report).includes("nothing asserts it, here or in the recording"), Drift.render(report));
});

test("sweep resolves its routes off the system, opens a real browser, and counts what it finds", withABrowser, async () => {
  // Everything above this line drives `Drift.check` with a `routeOf` the test wrote itself, and
  // `Drift.check` is not what runs: `witness check drift` calls `System.checkDrift`, which calls
  // `sweep`. So the part that builds `routeOf` out of `system.routeUrl`, launches the browser and
  // wires the sign-in action had no test at all — and an audit proved what that costs. Replace the
  // body of `sweep`'s `routeOf` with `undefined` and every claim vanishes: `all 0 claims still hold`,
  // ok, exit 0, a completely inert checker printing a green report. This is the test that goes red.
  const pages: Record<string, string> = {
    "/app/list": "<table><tr><td>a row</td></tr></table>",
    "/app/login": "<input placeholder='email'>",
  };
  const server = createServer((req, res) => {
    const body = pages[String(req.url)];
    res.writeHead(body ? 200 : 404, { "content-type": "text/html" }).end(body ?? "no");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const ran: string[] = [];
  // Annotated rather than cast: a cast makes every missing field optional, and the fields this hands
  // `sweep` are exactly the ones the composite root hands it.
  const system: SweepableSystem = {
    config: {
      actions: {
        signIn: { app: "app", steps: [{ goto: { route: "login" } }, { type: { on: { placeholder: "email" }, value: "x" } }] },
        open: { app: "app", steps: [{ goto: { route: "list" } }, { expect: { on: { role: "table" } } }, { expect: { on: { role: "button", name: "Nope" } } }] },
        atAPrompt: { app: "app", records: "terminal", steps: [{ expect: { on: "screen", text: "1 row" } }] },
      },
    },
    routeUrl: (app, route) => `http://127.0.0.1:${port}/${app}/${route}`,
    run: async name => void ran.push(name),
  };

  try {
    const report = await Drift.sweep(system, "signIn");
    // The claim on a resolvable route is COUNTED — the thing an inert `routeOf` silently takes to 0.
    equal(report.checked, 3, Drift.render(report));
    // And judged, on the page the route actually served, through the browser sweep opened itself.
    equal(report.ok, false, Drift.render(report));
    const gone = report.findings.filter(finding => finding.verdict === "gone");
    equal(gone.length, 1, Drift.render(report));
    equal(gone[0].action, "open");
    // The sign-in action sweep was named is the one it drove, and it drove it through the system.
    deepEqual(ran, ["signIn"]);
    // And the half with no screen came back in the same report rather than as a number.
    equal(report.skipped, 1, Drift.render(report));
  } finally {
    server.close();
  }
});

test("a terminal action cannot be the action that signs in, and is told so before a browser opens", when, async () => {
  // Driven anyway it spent thirty seconds on `locator('prompt')` and then reported the action as
  // broken — the checker's own assumption, wearing the words of a finding.
  await rejects(
    Drift.sweep({ config: { actions: { atAPrompt: { records: "terminal", steps: [] } } } } as never, "atAPrompt"),
    /no screen to sign a browser in on/,
  );
});
