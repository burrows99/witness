import { equal, match, ok } from "node:assert/strict";
import { test } from "node:test";

import { Skill } from "./skill.ts";
import { TypeSource } from "../config/types.ts";

const types = (): TypeSource =>
  new TypeSource().read(`
    export type StepConfig = {
      /** A human note for the trace. */
      note?: string;
      /** Go to one of an app's declared routes. */
      goto?: { route?: string };
      /** Click something. */
      click?: string;
    };
    export type SystemConfig = {
      name: string;
      /** What the product can DO. Sequences of steps. */
      actions?: Record<string, string>;
    };
  `);

const skill = (over: Partial<ConstructorParameters<typeof Skill>[0]> = {}): string =>
  new Skill({
    commands: [{ noun: "stack", summary: "what is up", verbs: [{ verb: "status", summary: "reachability of every service" }] }],
    types: types(),
    // What a reader types, pinned: the default is read off npm and this is not a test about npm.
    run: "npx witness",
    ...over,
  }).render();

test("it opens with frontmatter, so it can be used as a skill where skills live", () => {
  const out = skill();
  match(out, /^---\nname: witness\ndescription: >-/);
  match(out, /Drive this project's running app and come back with evidence/);
});

test("the commands are the command line's own, not a list somebody kept", () => {
  const out = skill({
    commands: [
      { noun: "stack", summary: "what is up", verbs: [{ verb: "status", summary: "reachability" }] },
      { noun: "order", summary: "orders", verbs: [{ verb: "show", summary: "<orderId>" }] },
    ],
  });
  match(out, /- `npx witness stack` — what is up/);
  match(out, /  - `stack status` — reachability/);
  match(out, /- `npx witness order` — orders/);
  match(out, /  - `order show` — <orderId>/);
});

test("the loop only offers commands this copy actually has", () => {
  const bare = skill();
  ok(!/witness api get/.test(bare), "no api noun, no api line");
  ok(!/witness db sql/.test(bare));
  const full = skill({
    commands: [
      { noun: "stack", summary: "s", verbs: [] },
      { noun: "api", summary: "a", verbs: [] },
      { noun: "db", summary: "d", verbs: [] },
    ],
  });
  match(full, /witness api get \/v1\/whatever\s+# read the real payload/);
  match(full, /witness db sql/);
});

test("the step verbs come from the type an action's steps are", () => {
  const out = skill();
  match(out, /- `goto` — Go to one of an app's declared routes\./);
  match(out, /- `click` — Click something\./);
  // `note` is bookkeeping, not something a step DOES.
  ok(!/- `note`/.test(out));
});

test("the config's fields come from the type that reads them, required marked", () => {
  const out = skill();
  match(out, /- `name` \(required\)/);
  match(out, /- `actions` — What the product can DO\./);
});

test("without a description it says how to get one; with one it names what the product has", () => {
  match(skill(), /The config is a template until you cut it down/);

  const described = new Skill({
    name: "acme",
    run: "npx witness",
    commands: [],
    types: types(),
    product: {
      apps: ["customer"],
      actions: [{ name: "customer.cancelOrder", summary: "cancel an order" }],
      queries: ["order.status"],
      operations: ["orders.show"],
      cast: ["regular"],
      secrets: ["adminKey"],
    },
  }).render();
  match(described, /^---\nname: acme/);
  match(described, /- \*\*apps\*\*: `customer`/);
  match(described, /  - `customer\.cancelOrder` — cancel an order/);
  match(described, /- \*\*operations\*\*: `orders\.show`/);
  match(described, /- \*\*queries\*\*: `order\.status`/);
  // A signed-in run needs these before it needs anything else, and they were findable only by
  // reading the config.
  match(described, /- \*\*cast\*\*: `regular`/);
  match(described, /- \*\*secrets it will ask for\*\*: `adminKey`/);
});

test("the providers are the registered ones", () => {
  const out = skill({ providers: new Map([["client", ["rest", "graphql"]]]) });
  match(out, /- \*\*client\*\*: `rest`, `graphql`/);
});

test("the part that cannot be generated is the part worth reading", () => {
  const out = skill();
  match(out, /## The shape of it/);
  match(out, /\*\*The command line is for state\.\*\*/);
  match(out, /\*\*An action is for behaviour\.\*\*/);
  // The claim the whole tool rests on: there is no file to write, so it had better say so.
  match(out, /\*\*There are no test files to write\*\*/);
});

test("witness's own features describe themselves", () => {
  // The guarantee: no list in here is written twice.
  const out = Skill.for().render();
  match(out, /- `npx witness stack` /);
  match(out, /- `goto` — Go to one of an app's declared routes/);
  match(out, /- \*\*video\*\*: `ffmpeg`/);
  match(out, /\.witness\/artifacts\/cli\/<the actions you ran>\/<cut>\//);
  match(out, /- `check` — A claim about the values collected so far/);
  equal(out.includes("undefined"), false);
});

test("what the command line is CALLED and what a skill may be NAMED are different things", () => {
  // A project whose config says `npm run acme --` — so its own help text reads correctly — cannot
  // carry that as a skill name, and its examples cannot say `witness`.
  const out = new Skill({
    name: "acme",
    run: "npm run acme --",
    commands: [
      { noun: "stack", summary: "what is up", verbs: [{ verb: "status", summary: "reachability" }] },
      { noun: "api", summary: "the api", verbs: [] },
    ],
    types: types(),
  }).render();

  match(out, /^---\nname: acme\n/);
  match(out, /npm run acme -- stack status\s+# is it up/);
  match(out, /- `npm run acme -- stack` — what is up/);
  match(out, /`EVIDENCE=before npm run acme -- action run …`/);
  ok(!/`witness stack`/.test(out), "the examples must be what this project actually types");
  // The one place the help's own name belongs: saying that it is not what you type.
  match(out, /Its own help calls it `acme`/);
  ok(!/^acme stack status/m.test(out), "an example must never be the untypeable name");
});

test("what a reader types is read off how the tool was run, not guessed", () => {
  // `npx witness` is right for a dependency and wrong for a vendored checkout; a config's `name` is what
  // the help prints and is often not a command (`npm run hesta --`, `aix`). npm knows which it was.
  equal(Skill.invocation({ npm_lifecycle_event: "hesta" }), "npm run hesta --");
  equal(Skill.invocation({}), "npx witness");
  // `npm test` runs the suite; nobody drives this through it, and it takes no `--`.
  equal(Skill.invocation({ npm_lifecycle_event: "test" }), "npx witness");
  // `npx witness skill` sets it to `npx`, which produced a file telling its reader to type `npm run npx --`.
  equal(Skill.invocation({ npm_lifecycle_event: "npx" }), "npx witness");
});

test("it says where a description comes from, which nothing generated can", () => {
  // The vocabulary is generated; the practice cannot be. An agent opening an undescribed product asks
  // "where do the words come from" first, and every list in this file answers a different question.
  const out = Skill.for().render();
  match(out, /## Describing what you ship/);
  match(out, /\*\*A locator you have not run is a guess\.\*\*/);
  match(out, /five of nine/);
});

test("it says where a thing belongs, which is the question a config asks first", () => {
  const out = Skill.for().render();
  match(out, /\*\*A service owns what is true about it\.\*\*/);
});
