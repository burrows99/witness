import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";

import { parseRunArgs } from "./run.ts";

test("names and inputs are told apart by the thing that makes them different", () => {
  // `witness action run app.signIn app.openSettings email=ada@example.com password=…`
  deepEqual(parseRunArgs(["app.signIn", "email=ada@example.com", "app.openSettings"]), {
    names: ["app.signIn", "app.openSettings"],
    inputs: { email: "ada@example.com" },
  });
});

test("a value can contain anything, including the character that separates it", () => {
  const { inputs } = parseRunArgs(["question=In one sentence: what = this?", "url=http://x/y?a=b"]);
  equal(inputs.question, "In one sentence: what = this?");
  equal(inputs.url, "http://x/y?a=b");
});

test("no arguments is no names, for the caller to refuse", () => {
  deepEqual(parseRunArgs([]), { names: [], inputs: {} });
});

/** A browser that records nothing and goes nowhere: the runner's job is the sequencing, not the driving. */
const fakeBrowser = (): { launch: () => Promise<never>; closed: string[] } => {
  const closed: string[] = [];
  const page = {};
  const context = {
    newPage: async () => page,
    // Playwright's own trace, which used to arrive only through the runner.
    tracing: { start: async () => undefined, stop: async ({ path }: { path: string }) => void closed.push(`trace ${path.split("/").pop()}`) },
    close: async () => void closed.push("context"),
  };
  const browser = {
    newContext: async () => context,
    close: async () => void closed.push("browser"),
  };
  return { launch: async () => browser as never, closed };
};

test("it runs each action in turn, passing what one stored to the next", async () => {
  const { runActions } = await import("./run.ts");
  const browser = fakeBrowser();
  const ran: { name: string; inputs: Record<string, unknown> }[] = [];
  let pinned: unknown;

  const system = {
    workspace: { resolve: (target = ".") => `/tmp/witness-run-test/${target}` },
    run: async (name: string, _page: never, inputs: Record<string, unknown>) => {
      ran.push({ name, inputs });
      return { action: name, ok: true, ms: 1, inputs, value: {}, values: { from: name }, steps: [], screenshots: [], network: [], console: [], recording: { requests: [], console: [], errors: [], dropped: 0 }, trace: [] };
    },
    evidence: () => ({ dir: "/tmp/witness-run-test/evidence", writeManifest: () => undefined }),
    pinEvidence: (context: unknown) => {
      pinned = context;
    },
    renderVideos: () => ["/tmp/witness-run-test/video.mp4"],
  };

  const result = await runActions(system as never, { names: ["first", "second"], inputs: { email: "ada@example.com" } }, { launch: browser.launch });

  deepEqual(ran.map(r => r.name), ["first", "second"]);
  // The first action's inputs are the caller's; the second also gets what the first stored.
  deepEqual(ran[0].inputs, { email: "ada@example.com" });
  deepEqual(ran[1].inputs, { email: "ada@example.com", from: "first" });
  equal(result.ok, true);
  deepEqual(result.evidence.videos, ["/tmp/witness-run-test/video.mp4"]);
  // Unpinned afterwards: the next thing to ask for evidence is not part of this run.
  equal(pinned, undefined);
  // The recording is written when the context closes, so it closes before anything looks for it.
  // The trace is written before the context closes: after that there is nothing left to write it from.
  deepEqual(browser.closed, ["trace trace.zip", "context", "browser"]);
});

test("a failing action comes back with its own evidence rather than a stack trace", async () => {
  const { runActions } = await import("./run.ts");
  const browser = fakeBrowser();
  const attached = { action: "second", ok: false, ms: 3, inputs: {}, value: {}, values: {}, steps: [{ step: "click", ms: 2, error: "no such button" }], screenshots: [], network: [], console: [], recording: { requests: [], console: [], errors: [], dropped: 0 }, trace: [], error: "no such button" };

  const system = {
    workspace: { resolve: (target = ".") => `/tmp/witness-run-test/${target}` },
    run: async (name: string) => {
      if (name === "second") throw Object.assign(new Error(`action "second" failed at step 1: no such button`), { result: attached });
      return { action: name, ok: true, ms: 1, inputs: {}, value: {}, values: {}, steps: [], screenshots: [], network: [], console: [], recording: { requests: [], console: [], errors: [], dropped: 0 }, trace: [] };
    },
    evidence: () => ({ dir: "/tmp/witness-run-test/evidence", writeManifest: () => undefined }),
    pinEvidence: () => undefined,
    renderVideos: () => [],
  };

  const result = await runActions(system as never, { names: ["first", "second", "third"], render: false }, { launch: browser.launch });
  equal(result.ok, false);
  match(result.error!, /action "second" failed at step 1: no such button/);
  // The one that broke is in there, with its steps — and `third` never ran.
  deepEqual(result.results.map(r => r.action), ["first", "second"]);
  ok(result.results[1].steps[0].error);
});
