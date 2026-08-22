import { deepEqual, equal, match, ok } from "node:assert/strict";
import { afterEach, test } from "node:test";

import { Cli } from "./cli.ts";
import type { Stack } from "../environment/stack.ts";
import { Trace } from "../diagnostics/trace.ts";

const stack = { suffix: "", root: "/checkout", status: async () => [] } as unknown as Stack;

/** Run a command and keep what it printed. */
const run = async (cli: Cli, argv: string[]): Promise<string> => {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((text: string) => {
    written.push(text);
    return true;
  }) as typeof process.stdout.write;
  try {
    await cli.run(argv);
  } finally {
    process.stdout.write = original;
  }
  return written.join("");
};

const originalStdout = process.stdout.write.bind(process.stdout);
afterEach(() => {
  process.stdout.write = originalStdout;
});

const withVerb = (run: (args: string[]) => unknown, trace?: Trace): Cli =>
  new Cli({ name: "acme", stack, trace }).command("order", { summary: "orders", verbs: { show: { summary: "<orderId>", run } } });

test("a verb is dispatched with its positional arguments", async () => {
  let got: string[] = [];
  const out = await run(withVerb(args => {
    got = args;
    return { id: args[0] };
  }), ["order", "show", "1234"]);
  deepEqual(got, ["1234"]);
  deepEqual(JSON.parse(out), { id: "1234" });
});

test("a flag is not a positional argument", async () => {
  // `api get /x --quiet` has one argument; treating the flag as a second one sent `--quiet` as a body.
  let got: string[] = [];
  await run(withVerb(args => {
    got = args;
    return "";
  }), ["order", "show", "1234", "--quiet"]);
  deepEqual(got, ["1234"]);
});

test("a verb typed the way anyone who has used curl types it still works", async () => {
  const out = await run(withVerb(() => "ok"), ["order", "SHOW"]);
  equal(out.trim(), "ok");
});

test("by default the whole exchange comes back, not just the answer", async () => {
  // The caller is usually an agent that cannot open a network tab, and "it returned nothing" is not a
  // diagnosis.
  const trace = new Trace();
  const cli = withVerb(() => {
    trace.add({ kind: "http", method: "GET", url: "/v1/orders/1", status: 200, ms: 3, at: "now" });
    return { id: "1" };
  }, trace);
  const out = JSON.parse(await run(cli, ["order", "show", "1"])) as { command: string; result: unknown; did: unknown[] };
  equal(out.command, "order show");
  deepEqual(out.result, { id: "1" });
  equal(out.did.length, 1);
});

test("--quiet prints the answer alone", async () => {
  const trace = new Trace();
  const out = await run(withVerb(() => ({ id: "1" }), trace), ["order", "show", "--quiet"]);
  deepEqual(JSON.parse(out), { id: "1" });
});

test("a string answer is printed as itself, not as JSON", async () => {
  equal(await run(withVerb(() => "http://localhost/link"), ["order", "show", "--quiet"]), "http://localhost/link\n");
});

test("a verb that answers nothing prints nothing", async () => {
  equal(await run(withVerb(() => undefined), ["order", "show", "--quiet"]), "");
});

test("an async verb is awaited", async () => {
  equal(await run(withVerb(async () => "later"), ["order", "show", "--quiet"]), "later\n");
});

test("usage lists every noun and verb, and how to read the output", async () => {
  const cli = withVerb(() => "").command("other", { summary: "another thing", passthrough: () => undefined });
  for (const argv of [[], ["help"], ["-h"], ["--help"]]) {
    const out = await run(cli, argv);
    match(out, /acme — drive the local stack/);
    match(out, /order\s+orders/);
    match(out, /show\s+<orderId>/);
    match(out, /other\s+another thing/);
    match(out, /Exit codes: 0 ok · 1 failed · 2 no such command/);
  }
});

test("a noun that takes the rest of the line gets it whole", async () => {
  let got: string[] = [];
  const cli = new Cli({ name: "acme", stack }).command("test", {
    summary: "run the suite",
    passthrough: args => {
      got = args;
    },
  });
  await cli.run(["test", "--headed", "specs/one.spec.ts"]);
  deepEqual(got, ["--headed", "specs/one.spec.ts"]);
});

test("verbs already registered under a noun can be added to rather than replaced", () => {
  const cli = withVerb(() => "");
  ok(cli.verbs("order")?.show);
  equal(cli.verbs("nothing-here"), undefined);
});

test("stack status is registered by default and reads the stack it was given", async () => {
  const cli = new Cli({
    name: "acme",
    stack: {
      suffix: "-583",
      root: "/checkout",
      status: async () => [
        { name: "api", url: "http://localhost:3002", reachable: true, container: "acme-api", containerUp: true },
        { name: "web", url: "http://localhost:3000", reachable: true, container: "acme-web", containerUp: false },
        { name: "search", url: "http://localhost:8080", reachable: true, container: "acme-search", answering: "other-project publishes this port, not acme-search" },
        { name: "worker", url: "http://localhost:4000", reachable: false, container: "acme-worker", containerUp: false },
      ],
    } as unknown as Stack,
  }).withDefaults({});

  const out = await run(cli, ["stack", "status", "--quiet"]);
  match(out, /stack -583 — resolved from \/checkout\/.env/);
  match(out, /api\s+http:\/\/localhost:3002\s+up\s+acme-api/);
  // Answering but with its container down: somebody runs it on the host, which is normal.
  match(out, /web\s+.*up\s+served from the host/);
  match(out, /search\s+.*NOT OURS\s+other-project publishes this port, not acme-search/);
  // Not answering AND its container is down means exactly what it says.
  match(out, /worker\s+.*DOWN\s+acme-worker is not running/);
});

test("the api, db and video verbs appear only when the config supports them", async () => {
  const bare = new Cli({ name: "acme", stack }).withDefaults({});
  equal(bare.verbs("api"), undefined);
  equal(bare.verbs("db"), undefined);

  const full = new Cli({ name: "acme", stack }).withDefaults({ api: async () => ({ ok: true }), sql: () => "1 row", renderVideos: () => ["a.mp4"] });
  deepEqual(Object.keys(full.verbs("api") ?? {}), ["get", "post", "patch", "delete"]);
  equal(await run(full, ["db", "sql", "select 1", "--quiet"]), "1 row\n");
});

test("api verbs pass a path and an optional JSON body", async () => {
  const seen: unknown[] = [];
  const cli = new Cli({ name: "acme", stack }).withDefaults({
    api: async (method, path, body) => {
      seen.push({ method, path, body });
      return {};
    },
  });
  await run(cli, ["api", "post", "/v1/things", '{"name":"x"}', "--quiet"]);
  deepEqual(seen[0], { method: "POST", path: "/v1/things", body: { name: "x" } });
});

test("a verb whose output IS the artefact is printed alone", async () => {
  // A config file to redirect into place, wrapped in a record of a request nobody made, is something
  // to unwrap again before it can be used.
  const trace = new Trace();
  const cli = new Cli({ name: "acme", stack, trace }).command("config", {
    summary: "the description",
    verbs: { template: { summary: "print one", raw: true, run: () => "{\n  \"name\": \"acme\"\n}" } },
  });
  equal(await run(cli, ["config", "template"]), '{\n  "name": "acme"\n}\n');
});

test("a command that fails still reports what it sent and what came back", async () => {
  // "GET /x → 401" is the headline; the exchange that produced it is what nobody can reconstruct after.
  const trace = new Trace();
  const cli = new Cli({ name: "acme", stack, trace }).command("api", {
    summary: "the api",
    verbs: {
      get: {
        summary: "GET",
        run: () => {
          trace.add({ kind: "http", method: "GET", url: "/v1/workspaces", status: 401, responseBody: '{"error":"Unauthorized"}', ms: 12, at: "now" });
          throw new Error("GET /v1/workspaces → 401");
        },
      },
    },
  });

  const said: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((text: string) => {
    said.push(text);
    return true;
  }) as typeof process.stderr.write;
  try {
    await cli.run(["api", "get", "/v1/workspaces"]).catch((err: Error) => err);
  } finally {
    process.stderr.write = original;
  }
  match(said.join(""), /"command": "api get"/);
  match(said.join(""), /Unauthorized/);
});

test("--quiet keeps a failure quiet — the message is the whole output", async () => {
  const trace = new Trace();
  const cli = new Cli({ name: "acme", stack, trace }).command("api", {
    summary: "the api",
    verbs: {
      get: {
        summary: "GET",
        run: () => {
          trace.add({ kind: "http", method: "GET", url: "/x", status: 500, ms: 1, at: "now" });
          throw new Error("boom");
        },
      },
    },
  });
  const said: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((text: string) => {
    said.push(text);
    return true;
  }) as typeof process.stderr.write;
  try {
    await cli.run(["api", "get", "/x", "--quiet"]).catch(() => undefined);
  } finally {
    process.stderr.write = original;
  }
  equal(said.join(""), "");
});
