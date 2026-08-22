import * as path from "node:path";

import type { Browser, Page } from "@playwright/test";

import type { ActionResult, Params } from "./engine.ts";
import type { EvidenceContext } from "../evidence/paths.ts";
import { requirePlaywright } from "../browser/playwright.ts";
import { slug } from "../evidence/paths.ts";

/**
 * Run declared actions in a browser, from a shell.
 *
 * An action is already data — a sequence of clicks and fills sitting in the config — so requiring a
 * spec file to execute one puts a program in the way of something that is not a program. That was the
 * tax: every question about the UI cost a file, an import and a runner invocation, and the answer to
 * "does this still work" was a commit.
 *
 * What comes back is the same evidence a spec produces — a frame per step, the network with bodies, the
 * debug story, a video — because the reason to drive the UI at all is to see what happened.
 *
 * A spec is still the place for assertions, branching and narration. This is for the sequence itself.
 */
export async function runActions(system: RunnableSystem, request: RunRequest, deps: RunDeps = {}): Promise<RunResult> {
  const { names, inputs = {}, headed = false, keep = false } = request;
  // Injectable so this can be tested without downloading a browser: a unit test that pulls Chromium is
  // not a unit test, and a CI job that fails for want of one stops publishing without stopping merging.
  const launch = deps.launch ?? (() => requirePlaywright("running an action from the command line").chromium.launch({ headless: !headed }));

  const cut = process.env.EVIDENCE ?? "run";
  // Truncation made two different chains share a directory, and a failed run's story sat inside a
  // passing run's bundle. A name that had to be cut carries what it lost.
  const label = runLabel(names);
  const group = path.join("cli", label, cut);
  // The runner's directory in a test run; here, ours — the video provider reads the manifest in it to
  // file the recording with the rest of this run's evidence.
  const outputDir = system.workspace.resolve(path.join("artifacts", "test-results", `cli-${label}`));
  const context: EvidenceContext = { source: "cli", test: label, cut, group, outputDir };

  const browser = await launch();
  const browserContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: outputDir, size: { width: 1280, height: 900 } },
  });
  // What the config says the system can BE. The same cookies a spec gets, for the same reason.
  const cookies = request.cookies ?? [];
  if (cookies.length) await browserContext.addCookies(cookies);
  // Playwright's trace: the DOM at every action, the network with bodies, the sources. It is a better
  // debugger for a PERSON than anything written here, and it used to arrive only through the runner —
  // so removing the runner would have quietly taken it away.
  await browserContext.tracing.start({ screenshots: true, snapshots: true, sources: true }).catch(() => undefined);
  const page = await browserContext.newPage();

  system.pinEvidence(context);
  const evidence = system.evidence();
  evidence.writeManifest(context);
  // Asked while it is still pinned: after the run it would answer `cli/adhoc`, which is where the
  // frames are NOT.
  const dir = evidence.dir;

  const results: ActionResult[] = [];
  let failure: Error | undefined;
  try {
    for (const name of names) {
      // Each action starts from where the last one left off: a sequence is why more than one is allowed.
      results.push(await system.run(name, page, { ...inputs, ...lastValues(results) }));
    }
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
    const attached = (failure as { result?: ActionResult }).result;
    if (attached) results.push(attached);
  } finally {
    // Where the story already says it will be, and written before the context closes: after that there
    // is nothing left to write it from.
    await browserContext.tracing.stop({ path: path.join(outputDir, "trace.zip") }).catch(() => undefined);
    // The video is written when the CONTEXT closes, so this happens before anything reads for it.
    await browserContext.close();
    if (!keep) await browser.close();
    system.pinEvidence(undefined);
  }

  // Turned into something watchable here rather than in a second command: the reason to drive a UI
  // from a shell is to see what happened, and a `.webm` named after a page id is not that.
  const videos = request.render === false ? [] : system.renderVideos();

  return {
    ok: !failure,
    results,
    error: failure?.message,
    // Where everything landed, so the answer to "and then what" is in the answer.
    evidence: { dir, recordings: outputDir, videos },
  };
}

/**
 * A directory name for a chain of actions, unique even when it has to be shortened.
 *
 * `slug(…, 64)` turned `a then b then averylongname` into `…-then-ops`, and the next chain that also
 * shortened to `…-then-ops` wrote its frames and its stories into the same bundle — a failed run's
 * story sitting inside a passing run's evidence.
 */
function runLabel(names: string[]): string {
  const full = names.join(" then ");
  const short = slug(full, 56);
  if (slug(full, 200) === short) return short;
  // A few characters of the whole name, so what was cut off still tells two runs apart.
  let hash = 0;
  for (const character of full) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `${short}-${hash.toString(36).slice(0, 4)}`;
}

/** What an action stored is available to the next one, the way steps within an action already are. */
function lastValues(results: ActionResult[]): Params {
  return results.length ? (results[results.length - 1].values ?? {}) : {};
}

/** `name`, and `key=value` for anything the actions take. */
export function parseRunArgs(args: string[]): { names: string[]; inputs: Params } {
  const names: string[] = [];
  const inputs: Params = {};
  for (const arg of args) {
    const pair = /^([\w.]+)=(.*)$/s.exec(arg);
    if (pair) inputs[pair[1]] = pair[2];
    else names.push(arg);
  }
  return { names, inputs };
}

export type RunRequest = {
  names: string[];
  /** Identity cookies to put in the context — what the config's `identities` declare. */
  cookies?: { name: string; value: string; domain: string; path: string }[];
  inputs?: Params;
  /** Watch it happen. The recording is the same either way. */
  headed?: boolean;
  /** Leave the browser open — for looking at what the last step left on the screen. */
  keep?: boolean;
  /** Turn the recording into an MP4. On by default: that is the point of recording it. */
  render?: boolean;
};

/** What the runner needs from the outside world, handed in so a test can hand in something else. */
export type RunDeps = { launch?: () => Promise<Browser> };

export type RunResult = {
  ok: boolean;
  results: ActionResult[];
  error?: string;
  evidence: { dir: string; recordings: string; videos: string[] };
};

/** The part of a system this needs, so the runner does not depend on the whole composite root. */
type RunnableSystem = {
  workspace: { resolve: (target?: string) => string };
  run: (action: string, page: Page, inputs: Params) => Promise<ActionResult>;
  evidence: () => { dir: string; writeManifest: (context: EvidenceContext) => void };
  pinEvidence: (context: EvidenceContext | undefined) => void;
  renderVideos: () => string[];
};
