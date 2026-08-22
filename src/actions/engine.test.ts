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
const fakePage = (opts: { text?: string; response?: unknown; gotoFails?: string } = {}): { page: never; did: Done } => {
  const did: Done = [];
  const locator = (what: string) => ({
    click: async () => void did.push(`click ${what}`),
    fill: async (value: string) => void did.push(`fill ${what} ${JSON.stringify(value)}`),
    pressSequentially: async (value: string) => void did.push(`type ${what} ${JSON.stringify(value)}`),
    textContent: async () => opts.text ?? "  on screen  ",
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
  await rejects(() => engine({}).run("nope", page), /no such action "nope" — see the config's actions/);
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
