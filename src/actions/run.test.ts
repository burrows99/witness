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
    // A lane's recording is named after the lane, so panes come out in the order they were asked for.
    pages: () => [
      {
        video: () => ({
          saveAs: async (to: string) => void closed.push(`video ${to.split("/").pop()}`),
          // `saveAs` copies; the original has to go or it is stitched in a second time.
          delete: async () => void closed.push("video removed"),
        }),
      },
    ],
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
    evidence: () => ({ dir: "/tmp/witness-run-test/evidence", writeManifest: () => undefined, readme: () => undefined }),
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
  // ONE lane for the whole chain: a sequence is one story and comes out as one continuous recording,
  // not as panes of things that were never happening at once. The trace is written before the context
  // closes — after that there is nothing left to write it from — and the recording named after.
  deepEqual(browser.closed, ["trace trace.zip", "context", "video panel-01-01.webm", "video removed", "browser"]);
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
    evidence: () => ({ dir: "/tmp/witness-run-test/evidence", writeManifest: () => undefined, readme: () => undefined }),
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

test("parallel gives each action its own lane, and the panes come out in the order asked for", async () => {
  const { runActions } = await import("./run.ts");
  const browser = fakeBrowser();
  const ran: string[] = [];
  const result = await runActions(
    {
      workspace: { resolve: (t?: string) => `/tmp/witness-run-test/${t ?? ""}` },
      run: async (action: string) => (ran.push(action), { action, ok: true, values: {} }) as never,
      evidence: () => ({ dir: "/tmp/witness-run-test/evidence", writeManifest: () => undefined, readme: () => undefined }),
      pinEvidence: () => undefined,
      renderVideos: () => [],
    },
    { names: ["one", "two", "three"], parallel: true, render: false },
    { launch: browser.launch },
  );
  ok(result.ok);
  // One lane per action, and the video provider stitches every `.webm` in the directory into panels
  // of one frame — which is the whole reason to run them together.
  deepEqual(
    browser.closed.filter(what => what.startsWith("video panel")),
    ["video panel-01-01.webm", "video panel-02-01.webm", "video panel-03-01.webm"],
  );
  deepEqual(ran.sort(), ["one", "three", "two"]);
});

test("a retry is a fresh browser, and keeps the failed attempt's evidence", async () => {
  const { runActions } = await import("./run.ts");
  const browser = fakeBrowser();
  let goes = 0;
  const filed: (string | undefined)[] = [];
  const result = await runActions(
    {
      workspace: { resolve: (t?: string) => `/tmp/witness-run-test/${t ?? ""}` },
      run: async (action: string, _p: unknown, _i: unknown, within?: { at?: string }) => {
        filed.push(within?.at);
        goes += 1;
        // Fails once, then works — the shape of every flake worth retrying.
        if (goes === 1) throw Object.assign(new Error("nope"), { result: { action, ok: false, values: {} } });
        return { action, ok: true, values: {} } as never;
      },
      evidence: () => ({ dir: "/tmp/witness-run-test/evidence", writeManifest: () => undefined, readme: () => undefined }),
      pinEvidence: () => undefined,
      renderVideos: () => [],
    },
    { names: ["flaky"], retries: 1, render: false },
    { launch: browser.launch },
  );
  ok(result.ok, "the retry decided the outcome");
  equal(goes, 2);
  // The failed go keeps its own directory: it is the interesting one, and overwriting it would leave
  // a green run with nothing to explain it.
  deepEqual(filed, [undefined, "flaky-retry-2"]);
  equal(browser.closed.filter(what => what.startsWith("video panel")).length, 2);
});
