import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { test } from "node:test";

import type { Evidence } from "../evidence/evidence.ts";
import type { Operations } from "../http/operations.ts";
import type { Queries } from "../database/queries.ts";
import { Trace } from "../diagnostics/trace.ts";

/**
 * The engine imports Playwright for its `expect` steps, so these run where the browser half is
 * installed and skip where it is not. Everything under test here is the step dispatcher, driven with a
 * page that records what it was asked to do rather than a real one.
 */
const havePlaywright = await import("@playwright/test").then(
  () => true,
  () => false,
);
const { Actions } = havePlaywright ? await import("./engine.ts") : ({ Actions: null } as never);
const when = { skip: havePlaywright ? false : "needs @playwright/test" };

type Done = string[];

/** A page that says what it was asked to do, and hands back whatever it was told to. */
const fakePage = (opts: { text?: string; all?: string[]; response?: unknown; gotoFails?: string } = {}): { page: never; did: Done } => {
  const did: Done = [];
  const locator = (what: string) => ({
    click: async () => void did.push(`click ${what}`),
    fill: async (value: string) => void did.push(`fill ${what} ${JSON.stringify(value)}`),
    pressSequentially: async (value: string) => void did.push(`type ${what} ${JSON.stringify(value)}`),
    textContent: async () => opts.text ?? "  on screen  ",
    allTextContents: async () => opts.all ?? [opts.text ?? "  on screen  "],
    count: async () => 1,
    filter: () => locator(what),
    nth: (n: number) => locator(`${what}#${n}`),
    or: () => locator(what),
  });
  const page = {
    goto: async (url: string) => {
      if (opts.gotoFails) throw new Error(opts.gotoFails);
      did.push(`goto ${url}`);
    },
    getByRole: (role: string, name: { name?: unknown }) =>
      locator(`role=${role}${name?.name ? ` name=${name.name instanceof RegExp ? name.name.source : String(name.name)}` : ""}`),
    getByPlaceholder: (value: string) => locator(`placeholder=${value}`),
    getByTestId: (value: string) => locator(`testId=${value}`),
    getByLabel: (value: string) => locator(`label=${value}`),
    getByText: (value: string) => locator(`text=${value}`),
    locator: (selector: string) => locator(`css=${selector}`),
    frameLocator: (selector: string) => ({ ...page, __frame: selector }),
    keyboard: { press: async (key: string) => void did.push(`press ${key}`) },
    waitForTimeout: async (ms: number) => void did.push(`wait ${ms}`),
    waitForURL: async (pattern: RegExp) => void did.push(`waitForUrl ${pattern.source}`),
    waitForResponse: async () => ({ json: async () => opts.response ?? {} }),
    on: () => undefined,
    off: () => undefined,
  };
  return { page: page as never, did };
};

const engine = (actions: Record<string, unknown>, opts: { api?: (name: string, params: unknown, body: unknown) => unknown; sql?: (name: string, params: unknown) => string } = {}) =>
  new Actions({
    operations: { call: async (name: string, params: unknown, body: unknown) => opts.api?.(name, params, body) ?? {} } as unknown as Operations,
    queries: { query: (name: string, params: unknown) => opts.sql?.(name, params) ?? "row" } as unknown as Queries,
    trace: new Trace(),
    actions: actions as never,
    url: (app: string, route: string, params: Record<string, unknown>) => `http://${app}/${route}/${Object.values(params).join("/")}`,
    evidence: () => ({ actionFrame: async () => "frames/01.png" }) as unknown as Evidence,
  });

test("an action is a sequence of steps against the page", when, async () => {
  const { page, did } = fakePage();
  const actions = engine({
    "customer.cancelOrder": {
      app: "customer",
      steps: [
        { goto: { route: "order", params: { orderId: "{orderId}" } } },
        { click: { role: "button", name: "Cancel order" } },
        { fill: { on: { placeholder: "Reason" }, value: "changed my mind about {orderId}" } },
        { press: "Enter" },
        { wait: 50 },
      ],
    },
  });
  const result = await actions.run("customer.cancelOrder", page, { orderId: "1234" });
  deepEqual(did, [
    "goto http://customer/order/1234",
    "click role=button name=Cancel order",
    'fill placeholder=Reason "changed my mind about 1234"',
    "press Enter",
    "wait 50",
  ]);
  ok(result.ok);
  equal(result.steps.length, 5);
  deepEqual(result.steps.map(s => s.step), ["goto", "click", "fill", "press", "wait"]);
});

test("what comes back is evidence, not a boolean", when, async () => {
  // Whoever reads the result — an agent, or a person reading CI — needs the screen and the traffic, not
  // "it failed".
  const { page } = fakePage();
  const result = await engine({ a: { steps: [{ click: "button" }, { wait: 1 }] } }).run("a", page);
  deepEqual(result.screenshots, ["frames/01.png", "frames/01.png"]);
  ok(result.steps.every(s => typeof s.ms === "number"));
  deepEqual(result.network, []);
  ok(Array.isArray(result.trace));
});

test("typed rather than filled, because these runs get recorded", when, async () => {
  // An instantly-full field reads as a bot in a video.
  const { page, did } = fakePage();
  await engine({ a: { steps: [{ type: { on: { label: "Email" }, value: "someone@example.com" } }] } }).run("a", page);
  deepEqual(did, ["click label=Email", 'fill label=Email ""', 'type label=Email "someone@example.com"']);
});

test("a value read off the screen is available to the steps after it", when, async () => {
  const { page, did } = fakePage({ text: "  Tuesday, 3pm  " });
  const result = await engine({
    a: { steps: [{ store: { from: { testId: "chosen-slot" }, as: "slot" } }, { fill: { on: "textarea", value: "see you {slot}" } }], returns: "{slot}" },
  }).run("a", page);
  equal(result.value, "Tuesday, 3pm");
  ok(did.includes('fill css=textarea "see you Tuesday, 3pm"'));
});

test("a step can ask the API or the database, and keep the answer", when, async () => {
  const { page } = fakePage();
  const asked: unknown[] = [];
  const result = await engine(
    {
      a: {
        steps: [
          { api: { operation: "orders.show", params: { orderId: "{orderId}" }, as: "status", pick: "status" } },
          { query: { name: "order.status", params: { orderId: "{orderId}" }, as: "stored" } },
        ],
      },
    },
    {
      api: (name, params) => {
        asked.push([name, params]);
        return { status: "cancelled" };
      },
      sql: () => "cancelled",
    },
  ).run("a", page, { orderId: "1234" });
  deepEqual(asked, [["orders.show", { orderId: "1234" }]]);
  deepEqual(result.values.status, "cancelled");
  deepEqual(result.values.stored, "cancelled");
});

test("a response the app never shows can be captured out of the traffic", when, async () => {
  const { page } = fakePage({ response: { data: { id: "created-99" } } });
  const result = await engine({ a: { steps: [{ capture: { url: "/v1/things", as: "thingId", pick: "data.id" } }] } }).run("a", page);
  equal(result.values.thingId, "created-99");
});

test("select picks the one item a previous step meant", when, async () => {
  const { page } = fakePage();
  const result = await engine({
    a: {
      steps: [
        { api: { operation: "modules.list", as: "modules" } },
        { select: { from: "modules", where: { name: "{wanted}" }, pick: "id", as: "moduleId" } },
      ],
    },
  }, { api: () => [{ id: "1", name: "other" }, { id: "2", name: "the one" }] }).run("a", page, { wanted: "the one" });
  equal(result.values.moduleId, "2");
});

test("select that matches nothing says what it was looking for", when, async () => {
  const { page } = fakePage();
  await rejects(
    () =>
      engine({ a: { steps: [{ api: { operation: "l", as: "items" } }, { select: { from: "items", where: { name: "gone" }, as: "x" } }] } }, { api: () => [] }).run("a", page),
    /select: nothing in "items" matches \{"name":"gone"\}/,
  );
});

test("an action can be built from other actions", when, async () => {
  // The small ones stay usable on their own, which is what a spec needs when the thing under test is
  // halfway through a flow.
  const { page, did } = fakePage();
  const result = await engine({
    signIn: { steps: [{ click: { role: "button", name: "Sign in" } }, { store: { from: "h1", as: "who" } }] },
    order: { steps: [{ run: "signIn" }, { click: { role: "button", name: "Order" } }] },
  }).run("order", page);
  ok(did.includes("click role=button name=Sign in"));
  ok(did.includes("click role=button name=Order"));
  equal(result.values.who, "on screen");
});

test("a failing step stops the action and brings its evidence with it", when, async () => {
  const { page } = fakePage({ gotoFails: "net::ERR_CONNECTION_REFUSED" });
  const failed = await engine({ a: { steps: [{ goto: { url: "http://nowhere" } }, { click: "button" }] } })
    .run("a", page)
    .catch((err: Error & { result: { ok: boolean; steps: { error?: string }[] } }) => err);
  ok(failed instanceof Error);
  match(failed.message, /action "a" failed at step 1: net::ERR_CONNECTION_REFUSED/);
  const result = (failed as Error & { result: { ok: boolean; steps: unknown[] } }).result;
  equal(result.ok, false);
  // The step that broke is the last one there is — nothing after it ran.
  equal(result.steps.length, 1);
});

test("an action nobody declared points at where they are declared", when, async () => {
  const { page } = fakePage();
  await rejects(() => engine({}).run("nope", page), /no such action "nope" — declared: none/);
  await rejects(() => engine({ "a.b": { steps: [] } }).run("nope", page), /no such action "nope" — declared: a\.b/);
});

test("a service's own action reaches its siblings by bare name", when, async () => {
  // Being under the same service is what says which `signIn` is meant; repeating the prefix inside it
  // says nothing new, and getting it wrong was a whole class of typo.
  const { page, did } = fakePage();
  await engine({
    "grafana.signIn": { steps: [{ press: "Enter" }] },
    "grafana.tour": { steps: [{ run: "signIn" }] },
  }).run("grafana.tour", page);
  deepEqual(did, ["press Enter"]);
});

test("a bare name that is not a sibling still means what it says", when, async () => {
  const { page, did } = fakePage();
  await engine({
    shared: { steps: [{ press: "Escape" }] },
    "grafana.tour": { steps: [{ run: "shared" }] },
  }).run("grafana.tour", page);
  deepEqual(did, ["press Escape"]);
});

test("the declared actions are listed, which is what the command line offers", when, () => {
  deepEqual(engine({ a: { steps: [] }, b: { steps: [] } }).names, ["a", "b"]);
});

test("a whole-placeholder input keeps its type instead of becoming text", when, async () => {
  const { page, did } = fakePage();
  await engine({ a: { steps: [{ fillFields: "{fields}" }] } }).run("a", page, { fields: { Heading: "A title", Body: "Some body" } });
  ok(did.some(d => d.includes('"A title"')));
  ok(did.some(d => d.includes('"Some body"')));
});

test("waiting for a URL can say how long to wait", when, async () => {
  // The wait IS how some steps fail — a rejected sign-in never navigates — and a default minute of
  // nothing per attempt is the difference between a loop and a coffee break.
  const waits: number[] = [];
  const { page } = fakePage();
  const withWait = {
    ...(page as unknown as Record<string, unknown>),
    waitForURL: async (_pattern: RegExp, opts: { timeout: number }) => {
      waits.push(opts.timeout);
    },
  } as never;

  await engine({
    a: { steps: [{ waitForUrl: "/chat" }, { waitForUrl: { url: "/chat", timeout: 2000 } }] },
  }).run("a", withWait);
  deepEqual(waits, [60_000, 2000]);
});

test("every step is named by what it does, and says what it is about", when, async () => {
  // The first section of a story is the one people read, and half of it used to say nothing: a step
  // that only stored was labelled "step", and `run`, `api`, `query` and `goto` carried no detail at all.
  const { page } = fakePage({ text: "Tuesday" });
  const result = await engine(
    {
      nested: { steps: [{ wait: 1 }] },
      a: {
        steps: [
          { goto: { url: "http://localhost:3000/login" } },
          { store: { from: { testId: "slot" }, as: "slot" } },
          { run: "nested" },
          { api: { operation: "orders.show", as: "order" } },
          { query: { name: "order.status", as: "status" } },
          { press: "Enter" },
          { wait: 250 },
          { waitForUrl: { url: "/chat", timeout: 10 } },
          { click: { role: "button", name: "Cancel" }, note: "the one in the dialog" },
        ],
      },
    },
    { api: () => ({}), sql: () => "cancelled" },
  ).run("a", {
    ...(fakePage().page as unknown as Record<string, unknown>),
    waitForURL: async () => undefined,
    textContent: async () => "Tuesday",
  } as never);

  deepEqual(
    result.steps.map(s => [s.step, s.detail]),
    [
      ["goto", "http://localhost:3000/login"],
      ["store", "testId=slot"],
      ["run", "nested"],
      ["api", "orders.show"],
      ["query", "order.status"],
      ["press", "Enter"],
      ["wait", "250ms"],
      ["waitForUrl", "/chat"],
      // A note is the human explanation, and it wins over the locator.
      ["click", "the one in the dialog"],
    ],
  );
  ok(page);
});

test("a step's detail never carries the value it typed", when, async () => {
  // Stories get pasted into pull requests, and half the `fill` steps in any product are passwords.
  const { page } = fakePage();
  const result = await engine({ a: { steps: [{ fill: { on: { label: "Password" }, value: "hunter2" } }] } }).run("a", page);
  equal(result.steps[0].detail, "label=Password");
  ok(!JSON.stringify(result.steps).includes("hunter2"));
});

test("an action that declares what it needs says so before it starts", when, async () => {
  // Otherwise it opens a browser, loads a page and dies three steps in on an unfilled `{placeholder}`.
  const { page, did } = fakePage();
  const actions = engine({
    open: { app: "ops", inputs: ["memberId"], steps: [{ goto: { route: "member", params: { memberId: "{memberId}" } } }] },
  });

  await rejects(() => actions.run("open", page), /action "open" needs `memberId` — given nothing/);
  await rejects(() => actions.run("open", page, { other: 1 }), /needs `memberId` — given `other`/);
  deepEqual(did, [], "nothing should have been driven");

  // …and with it, the action runs.
  const ok = await actions.run("open", page, { memberId: "m-1" });
  equal(ok.ok, true);
});

test("what counts as off-screen, and what does not", when, async () => {
  // The one failure mode that yields a green run AND a wrong deliverable: an assertion satisfied by a
  // node that is not in the picture beside it.
  const { Actions } = await import("./engine.ts");
  const page = { viewportSize: () => ({ width: 1280, height: 900 }) } as never;
  const at = (box: { x: number; y: number; width: number; height: number } | null) =>
    ({ first: () => ({ boundingBox: async () => box }) }) as never;

  equal(await Actions.offScreen(page, at({ x: 20, y: 40, width: 300, height: 200 })), undefined, "in the frame");
  equal(await Actions.offScreen(page, at({ x: 0, y: 880, width: 300, height: 200 })), undefined, "half in is in");
  match((await Actions.offScreen(page, at({ x: 0, y: -400, width: 300, height: 200 })))!, /outside the viewport \(at 0,-400 in 1280×900\)/);
  match((await Actions.offScreen(page, at({ x: 1400, y: 10, width: 100, height: 20 })))!, /outside the viewport/);
  match((await Actions.offScreen(page, at(null)))!, /no box on the page/);

  // Silent when it cannot tell: this adds a sentence to a story, it never fails a run.
  equal(await Actions.offScreen({ viewportSize: () => null } as never, at({ x: 0, y: 0, width: 1, height: 1 })), undefined);
  equal(
    await Actions.offScreen(page, { first: () => ({ boundingBox: async () => { throw new Error("gone"); } }) } as never),
    undefined,
  );
});

test("store reads one thing, or every one of them", when, async () => {
  // "What is this control offering?" — every option in a picker — was unprovable from an action: the
  // only answer was a strict-mode violation that happened to mention the count.
  const { page } = fakePage();
  const options = ["What to expect", "Questionnaire", "Booking"];
  const withOptions = {
    ...(page as unknown as Record<string, unknown>),
    getByRole: () => ({
      textContent: async () => "What to expect",
      allTextContents: async () => [...options, "  "],
    }),
  } as never;

  const result = await engine({
    a: {
      steps: [
        { store: { from: { role: "option" }, as: "first" } },
        { store: { from: { role: "option" }, as: "offered", all: true } },
      ],
    },
  }).run("a", withOptions);

  equal(result.values.first, "What to expect");
  deepEqual(result.values.offered, options, "blank matches are not options");
});

test("a check is the claim one layer makes against another", when, async () => {
  // `expect` only sees the screen. What the API answered against what the screen shows was the last
  // thing a description could not say, and the reason a spec file still existed.
  const { page } = fakePage({ text: "3" });
  const result = await engine(
    {
      a: {
        steps: [
          { api: { operation: "stats", as: "stats" } },
          { store: { from: { testId: "count" }, as: "shown" } },
          { check: { that: "{shown}", equals: "{stats.dashboards}", because: "the screen should agree with the API" } },
        ],
      },
    },
    { api: () => ({ dashboards: 3 }) },
  ).run("a", page);
  ok(result.ok);
});

test("a check that does not hold fails the action, and says what it saw", when, async () => {
  const { page } = fakePage({ text: "7" });
  await rejects(
    () =>
      engine(
        { a: { steps: [{ api: { operation: "stats", as: "stats" } }, { store: { from: "b", as: "shown" } }, { check: { that: "{shown}", equals: "{stats.dashboards}", because: "the screen should agree with the API" } }] } },
        { api: () => ({ dashboards: 3 }) },
      ).run("a", page),
    /the screen should agree with the API — "\{shown\}" is "7", not "3"/,
  );
});

test("a check counts what a list-reading store gathered", when, async () => {
  const { page } = fakePage({ text: "anything" });
  const run = (atLeast: number) =>
    engine({ a: { steps: [{ store: { from: "li", as: "offered", all: true } }, { check: { that: "{offered.length}", atLeast } }] } }).run("a", page);
  ok((await run(1)).ok);
  await rejects(() => run(5), /which is less than 5/);
});

test("the other comparisons a claim about a value needs", when, async () => {
  const { page } = fakePage({ text: "Prometheus data source" });
  const check = (spec: Record<string, unknown>) => engine({ a: { steps: [{ store: { from: "h1", as: "title" } }, { check: { that: "{title}", ...spec } }] } }).run("a", page);
  ok((await check({ contains: "Prometheus" })).ok);
  ok((await check({ matches: "^Prometheus" })).ok);
  ok((await check({ not: "something else" })).ok);
  await rejects(() => check({ contains: "Graphite" }), /does not contain "Graphite"/);
  await rejects(() => check({ matches: "^Graphite" }), /does not match/);
  await rejects(() => check({ atMost: 3 }), /wants a number/);
});

test("a composed action can be given inputs of its own", when, async () => {
  // Without this a composed action could only run on whatever values happened to be lying around, so
  // one taking an input could be composed once and never twice.
  const { page, did } = fakePage();
  await engine({
    search: { app: "app", inputs: ["term"], steps: [{ fill: { on: { placeholder: "Search" }, value: "{term}" } }] },
    both: { steps: [{ run: { action: "search", with: { term: "prometheus" } } }, { run: { action: "search", with: { term: "graphite" } } }] },
  }).run("both", page);
  deepEqual(did, ['fill placeholder=Search "prometheus"', 'fill placeholder=Search "graphite"']);
});

test("the string form of run still means the same thing", when, async () => {
  const { page, did } = fakePage();
  await engine({ inner: { steps: [{ press: "Enter" }] }, outer: { steps: [{ run: "inner" }] } }).run("outer", page);
  deepEqual(did, ["press Enter"]);
});

test("an action can leave the note a person re-walks it by", when, async () => {
  // The instructions recommended `evidence.manualVerification()` — an API reachable only by writing
  // code, in a tool whose whole claim is that there is no file to write.
  const written: Record<string, string> = {};
  const { page } = fakePage({ text: "Tuesday, 3pm" });
  const actions = new Actions({
    operations: { call: async () => ({}) } as unknown as Operations,
    queries: { query: () => "row" } as unknown as Queries,
    trace: new Trace(),
    actions: {
      a: {
        steps: [{ store: { from: { testId: "slot" }, as: "slot" } }],
        verify: {
          title: "The booking",
          subject: { slot: "{slot}", missing: "{nothing.stored}" },
          signIn: ["open http://localhost:3000"],
          notes: ["they picked {slot}"],
        },
      },
    } as never,
    url: () => "http://app/",
    evidence: () =>
      ({
        actionFrame: async () => "frames/01.png",
        manualVerification: (opts: { title: string; subject?: Record<string, string | undefined>; notes?: string[] }) => {
          written.title = opts.title;
          written.slot = opts.subject?.slot ?? "";
          written.notes = (opts.notes ?? []).join("|");
          // A subject naming something no step stored keeps its line and says what is missing from
          // it: a note is a courtesy, but a silent one is worse than none.
          written.missing = String(opts.subject?.missing);
          return "manual-verification.md";
        },
      }) as unknown as Evidence,
  });
  const result = await actions.run("a", page);
  ok(result.ok);
  equal(written.title, "The booking");
  equal(written.slot, "Tuesday, 3pm");
  equal(written.notes, "they picked Tuesday, 3pm");
  equal(written.missing, "«nothing.stored — nothing stored that»");
});

test("an action with no verify writes no note", when, async () => {
  let wrote = false;
  const { page } = fakePage();
  const actions = new Actions({
    operations: { call: async () => ({}) } as unknown as Operations,
    queries: { query: () => "row" } as unknown as Queries,
    trace: new Trace(),
    actions: { a: { steps: [{ press: "Enter" }] } } as never,
    url: () => "http://app/",
    evidence: () => ({ actionFrame: async () => "f.png", manualVerification: () => ((wrote = true), "x") }) as unknown as Evidence,
  });
  await actions.run("a", page);
  equal(wrote, false);
});

test("a step can use a declared secret without the caller typing one", when, async () => {
  const { page, did } = fakePage();
  const actions = new Actions({
    operations: { call: async () => ({}) } as unknown as Operations,
    queries: { query: () => "row" } as unknown as Queries,
    trace: new Trace(),
    actions: { signIn: { steps: [{ type: { on: { placeholder: "password" }, value: "{secret.adminPassword}" } }] } } as never,
    url: () => "http://app/",
    evidence: () => ({ actionFrame: async () => "f.png" }) as unknown as Evidence,
    secret: (name: string) => (name === "adminPassword" ? "hunter2" : ""),
  });
  const result = await actions.run("signIn", page);
  ok(did.includes('type placeholder=password "hunter2"'));
  // …and it is nowhere in what comes back. `values` is returned to the caller and printed as JSON by
  // the command line, so a secret kept there is a password on somebody's terminal.
  ok(!JSON.stringify(result).includes("hunter2"), "a credential must not survive into the result");
});

test("a secret is only read when a step actually asks for one", when, async () => {
  // A config declares secrets it does not always use, and reading one means an exec into a running
  // container — which fails when that container is not what the run is about.
  const asked: string[] = [];
  const actions = new Actions({
    operations: { call: async () => ({}) } as unknown as Operations,
    queries: { query: () => "row" } as unknown as Queries,
    trace: new Trace(),
    actions: { a: { steps: [{ press: "Enter" }] } } as never,
    url: () => "http://app/",
    evidence: () => ({ actionFrame: async () => "f.png" }) as unknown as Evidence,
    secret: (name: string) => (asked.push(name), "x"),
  });
  await actions.run("a", fakePage().page);
  deepEqual(asked, []);
});

test("a system with no way to resolve secrets says so", when, async () => {
  await rejects(
    () => engine({ a: { steps: [{ fill: { on: "input", value: "{secret.token}" } }] } }).run("a", fakePage().page),
    /\{secret\.token\} — this system was built without any way to resolve secrets/,
  );
});

test("a note whose template names nothing stored is a warning, not a silence", when, async () => {
  // Dropping the line left three of four notes missing from a run that reported `ok: true` — in the
  // one file whose whole job is being trustworthy to somebody who did not watch the run.
  let written: { notes?: string[] } = {};
  const actions = new Actions({
    operations: { call: async () => ({}) } as unknown as Operations,
    queries: { query: () => "row" } as unknown as Queries,
    trace: new Trace(),
    actions: {
      a: {
        steps: [{ store: { from: { testId: "x" }, as: "repo" } }],
        verify: { title: "T", notes: ["made {repo}", "owned by {owner}"] },
      },
    } as never,
    url: () => "http://app/",
    evidence: () =>
      ({
        actionFrame: async () => "f.png",
        manualVerification: (opts: { notes?: string[] }) => ((written = opts), "manual-verification.md"),
      }) as unknown as Evidence,
  });
  const result = await actions.run("a", fakePage({ text: "the-repo" }).page);
  ok(result.ok, "a note is a courtesy and must not fail a run that worked");
  // The line stays, and says what is missing from it.
  deepEqual(written.notes, ["made the-repo", "owned by «owner — nothing stored that»"]);
  equal(result.warnings.length, 1);
  match(result.warnings[0], /verify: missing \{owner\}/);
});

test("a run with nothing to report has nothing to say", when, async () => {
  const result = await engine({ a: { steps: [{ press: "Enter" }] } }).run("a", fakePage().page);
  deepEqual(result.warnings, []);
});

test("what `verify` says the run was about is available to its own notes", when, async () => {
  // `subject` names who the run was about, and a note saying so is the commonest thing anybody writes.
  let written: { notes?: string[] } = {};
  const actions = new Actions({
    operations: { call: async () => ({}) } as unknown as Operations,
    queries: { query: () => "row" } as unknown as Queries,
    trace: new Trace(),
    actions: {
      a: { steps: [], verify: { title: "T", subject: { user: "ada" }, notes: ["signed in as {user}"] } },
    } as never,
    url: () => "http://app/",
    evidence: () =>
      ({ actionFrame: async () => "f.png", manualVerification: (opts: { notes?: string[] }) => ((written = opts), "m.md") }) as unknown as Evidence,
  });
  const result = await actions.run("a", fakePage().page);
  deepEqual(written.notes, ["signed in as ada"]);
  deepEqual(result.warnings, []);
});

test("a value a step stored beats one the subject named", when, async () => {
  // The step read it off the screen, which is the more specific answer.
  let written: { notes?: string[] } = {};
  const actions = new Actions({
    operations: { call: async () => ({}) } as unknown as Operations,
    queries: { query: () => "row" } as unknown as Queries,
    trace: new Trace(),
    actions: {
      a: {
        steps: [{ store: { from: { testId: "who" }, as: "user" } }],
        verify: { title: "T", subject: { user: "whoever the config guessed" }, notes: ["it was {user}"] },
      },
    } as never,
    url: () => "http://app/",
    evidence: () =>
      ({ actionFrame: async () => "f.png", manualVerification: (opts: { notes?: string[] }) => ((written = opts), "m.md") }) as unknown as Evidence,
  });
  await actions.run("a", fakePage({ text: "ada, off the screen" }).page);
  deepEqual(written.notes, ["it was ada, off the screen"]);
});

test("a composed action's evidence lives inside the step that ran it", when, async () => {
  // A flat `actions/` folder could not say who ran what: the composing action sat as a SIBLING of
  // the eight it composed, and nothing on disk showed the difference.
  const wrote: string[] = [];
  const actions = new Actions({
    operations: { call: async () => ({}) } as unknown as Operations,
    queries: { query: () => "row" } as unknown as Queries,
    trace: new Trace(),
    actions: {
      "app.signIn": { steps: [{ press: "Enter" }] },
      "app.tour": { steps: [{ press: "Escape" }, { run: "signIn" }] },
    } as never,
    url: () => "http://app/",
    evidence: () =>
      ({
        actionFrame: async (_p: unknown, at: string, i: number, name: string) => {
          wrote.push(`${at}/${String(i).padStart(2, "0")}-${name}.png`);
          return "f.png";
        },
        write: (name: string) => (wrote.push(name), name),
        // `tell` needs these to build the story; without them it fails quietly and writes nothing.
        dir: "/tmp/witness",
        artefacts: () => ({}),
      }) as unknown as Evidence,
  });
  await actions.run("app.tour", fakePage().page, {});
  // Numbered for the parent's own step list, so the child ties to the step without a second ordering.
  ok(
    wrote.includes("app-tour/02-signin/01-press.png"),
    `expected the composed action under its step; got ${wrote.join(", ")}`,
  );
  ok(wrote.includes("app-tour/02-signin/debug.md"), "and its story beside its frames");
  // No frame for the `run` step itself: the action it ran ends with one of that same screen.
  ok(!wrote.some(file => file.includes("02-run.png")), `a run step should take no frame: ${wrote.join(", ")}`);
});
