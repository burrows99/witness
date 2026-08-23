import * as path from "node:path";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import type { ActionConfig, ActionResult, Params } from "./engine.ts";
import type { EvidenceContext } from "../evidence/paths.ts";
import { markRecordingStart, pane } from "../browser/narration.ts";
import { recorderProviders } from "../providers/recorders.ts";
import { requirePlaywright } from "../browser/playwright.ts";
import { writeSlideCards } from "../evidence/recording.ts";
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
  const { names, inputs = {}, headed = false, keep = false, parallel = false, retries = 0 } = request;
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
  const cookies = request.cookies ?? [];
  // Slides are timed from here, so a card lands where the run actually showed it.
  markRecordingStart();

  /** A lane: its own context, its own page, its own recording. One of these per pane. */
  const lane = async (): Promise<Lane> => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      recordVideo: { dir: outputDir, size: { width: 1280, height: 900 } },
    });
    // What the config says the system can BE. The same cookies a spec gets, for the same reason.
    if (cookies.length) await context.addCookies(cookies);
    return { context, page: await context.newPage() };
  };

  system.pinEvidence(context);
  const evidence = system.evidence();
  evidence.writeManifest(context);
  // Asked while it is still pinned: after the run it would answer `cli/adhoc`, which is where the
  // frames are NOT.
  const dir = evidence.dir;

  const results: ActionResult[] = [];
  let failure: Error | undefined;

  /**
   * One action, and the attempts it takes.
   *
   * A retry is a fresh lane: a browser left on the screen the failure happened on is not a place to
   * start again from. Every attempt keeps its own evidence — the one that FAILED is the interesting
   * one, and a retry that quietly overwrote it would leave a green run with nothing to explain it.
   */
  /**
   * An action with no screen, filmed by whatever its service says films it.
   *
   * It never opens a browser: the recorder drives the steps itself and leaves a video of the same
   * shape a pane has, which is what lets a shell sit beside a screen in one frame.
   */
  const recordTerminal = (name: string, action: ActionConfig, at: string, label?: { title: string; sub?: string }): ActionResult => {
    // Named by the service; there is no default, because a service that names nothing gets a browser
    // and never reaches here.
    const recorder = recorderProviders.get(action.records!);
    const started = Date.now();
    const wrote = recorder.available()
      // Spread, so the pane the description asks for reaches the recorder that has honoured `width`,
      // `height` and `fontSize` since it was written — and left them unreachable for want of this line.
      ? recorder.record(action.steps ?? [], inputs, path.join(outputDir, `panel-${at}-01.mp4`), { ...action.pane, shell: action.shell, label })
      : undefined;
    if (!wrote) process.stderr.write(`[terminal] ${name} was not recorded — is \`vhs\` installed?\n`);
    return {
      action: name,
      ok: true,
      ms: Date.now() - started,
      inputs,
      value: undefined,
      values: {},
      warnings: wrote ? [] : ["this needs `vhs` on the path to be recorded (brew install vhs)"],
      steps: (action.steps ?? []).map(step => ({ step: Object.keys(step)[0], ms: 0 })),
      screenshots: [],
      network: [],
      console: [],
      recording: { requests: [], console: [], errors: [], dropped: 0 },
      trace: [],
    };
  };

  const attempt = async (name: string, at: string, values: Params, on?: Lane, dir?: string, label?: { title: string; sub?: string }): Promise<ActionResult> => {
    // No screen, no browser: the recorder is the whole of this lane.
    const terminal = system.actionConfig?.(name);
    if (terminal?.records === "terminal") return recordTerminal(name, terminal, at, label);

    for (let n = 1; n <= retries + 1; n += 1) {
      // A chain shares one lane, because it is one story and should be one continuous recording. A
      // retry always gets a fresh one: a browser left on the screen the failure happened on is not a
      // place to start again from.
      const own = on && n === 1 ? undefined : await lane();
      const using = own ?? on!;
      if (own && label) await pane(using.page, label.title, label.sub).catch(() => undefined);
      // `checkout`, then `checkout-retry-2` — so the tree says how many goes it took without anybody
      // having to diff two directories to find out.
      const into = n === 1 ? dir : `${dir ?? slug(name, 56)}-retry-${n}`;
      try {
        const result = await system.run(name, using.page, values, { at: into });
        if (own) await finish(own.context, at, n);
        return result;
      } catch (err) {
        if (own) await finish(own.context, at, n);
        // The last go: the caller sees the failure, as it would with no retries at all.
        if (n === retries + 1) throw err;
        process.stderr.write(`[retry] ${name} failed on attempt ${n} of ${retries + 1} — going again\n`);
      }
    }
    throw new Error("unreachable");
  };

  /** Close a lane and name its recording, so the panes come out in the order they were asked for. */
  const finish = async (lanes: BrowserContext, at: string, attemptNumber: number): Promise<void> => {
    const video = lanes.pages()[0]?.video();
    const only = at === "01" && attemptNumber === 1;
    await lanes.tracing.stop({ path: path.join(outputDir, `trace${only ? "" : `-${at}-${attemptNumber}`}.zip`) }).catch(() => undefined);
    // The video is written when the CONTEXT closes, so this happens before anything reads for it.
    await lanes.close();
    // `panel-NN.webm` is what the video provider orders panes by; without it they come out in
    // page-id order, which is nobody's intended reading. `saveAs` COPIES — the original stays where
    // the browser put it, and every one left behind is a pane stitched in twice.
    const saved = await video
      ?.saveAs(path.join(outputDir, `panel-${at}-${String(attemptNumber).padStart(2, "0")}.webm`))
      .then(() => true)
      .catch(() => false);
    // Only once the copy is definitely there. Deleting regardless turned a recording that failed to
    // copy into no recording at all — silently, because both halves swallow their errors.
    if (saved) await video?.delete().catch(() => undefined);
  };

  try {
    if (parallel) {
      // Side by side, in one recording, because that is the whole point of running them together: the
      // video provider stitches every `.webm` in this directory into panels of one frame.
      const lanes = await Promise.allSettled(
        names.map((name, index) => {
          const lane = String(index + 1).padStart(2, "0");
          // `01-grafana-signin` beside `panel-01`: the directory says which pane it is, and two lanes
          // running the SAME action no longer write their evidence over each other.
          return attempt(name, lane, { ...inputs }, undefined, `${lane}-${slug(name, 52)}`, {
            // Four recordings side by side are four things happening at once and no way to tell which
            // is which. The pane says who it is, for the whole of it.
            title: name,
            sub: request.labels?.[name],
          });
        }),
      );
      for (const [index, settled] of lanes.entries()) {
        if (settled.status === "fulfilled") results.push(settled.value);
        else {
          const attached = (settled.reason as { result?: ActionResult })?.result;
          if (attached) results.push(attached);
          // The first failure is the one reported; the rest are in their own results and stories.
          failure ??= settled.reason instanceof Error ? settled.reason : new Error(String(settled.reason));
          process.stderr.write(`[parallel] ${names[index]} failed\n`);
        }
      }
    } else {
      // One lane for the whole chain: each action starts from where the last one left off, which is
      // why more than one is allowed — and it comes out as ONE continuous recording rather than as
      // panes of things that were never happening at once.
      //
      // Opened only when something actually needs a screen: a chain of terminal actions would
      // otherwise record a blank browser beside the shell it was really about.
      let only: Lane | undefined;
      try {
        for (const [index, name] of names.entries()) {
          const config = system.actionConfig?.(name);
          if (config?.records === "terminal") {
            results.push(recordTerminal(name, config, String(index + 1).padStart(2, "0"), { title: name, sub: config.summary }));
            continue;
          }
          only ??= await lane();
          results.push(await attempt(name, "01", { ...inputs, ...lastValues(results) }, only));
        }
      } finally {
        if (only) await finish(only.context, "01", 1);
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err));
    const attached = (failure as { result?: ActionResult }).result;
    if (attached) results.push(attached);
  } finally {
    // One full-frame card per slide, spliced into the timeline — rather than the same title painted
    // into every pane, which reads as several things happening at once. In the `finally`, because a
    // run that FAILED is the one whose narration somebody most wants to follow — and it had been
    // sitting in the `catch`, which is the only place it could never help.
    await writeSlideCards({ browser, outputDir, panes: parallel ? names.length : 1 }).catch(() => undefined);
    if (!keep) await browser.close();
    system.pinEvidence(undefined);
  }

  // Turned into something watchable here rather than in a second command: the reason to drive a UI
  // from a shell is to see what happened, and a `.webm` named after a page id is not that.
  const videos = request.render === false ? [] : system.renderVideos();
  // Written last, so it describes what is actually there — including the video, which does not exist
  // until the line above. Pinned again for the moment it takes: unpinned, `evidence()` answers
  // `cli/adhoc`, which is where this run's directories are NOT.
  system.pinEvidence(context);
  try {
    system.evidence().readme();
  } finally {
    system.pinEvidence(undefined);
  }

  return {
    ok: !failure,
    results,
    // Gathered to the top: what an agent reads is this object, and a warning buried one level down in
    // an action's own result is a warning nobody sees.
    warnings: results.flatMap(result => (result.warnings ?? []).map(warning => `${result.action}: ${warning}`)),
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
  /**
   * Drive every named action at once, each in its own browser, stitched into panels of one video.
   *
   * They cannot thread values into each other when they run together, so each gets the inputs the
   * caller passed and nothing else. Off by default: a chain that signs in and then does something is
   * the commoner case, and running THAT in parallel signs in twice and does the thing signed out.
   */
  parallel?: boolean;
  /** How many more goes a failing action gets. Each is a fresh browser, and keeps its own evidence. */
  retries?: number;
  /** What to write on each pane's header, by action name. Defaults to the action's own name alone. */
  labels?: Record<string, string>;
  /** Turn the recording into an MP4. On by default: that is the point of recording it. */
  render?: boolean;
};

/** One browser, one page, one recording: a pane, or the whole of a sequential run. */
type Lane = { context: BrowserContext; page: Page };

/** What the runner needs from the outside world, handed in so a test can hand in something else. */
export type RunDeps = { launch?: () => Promise<Browser> };

export type RunResult = {
  ok: boolean;
  results: ActionResult[];
  /** What the run got away with — true, and worth reading, even when `ok`. */
  warnings: string[];
  error?: string;
  evidence: { dir: string; recordings: string; videos: string[] };
};

/** The part of a system this needs, so the runner does not depend on the whole composite root. */
type RunnableSystem = {
  workspace: { resolve: (target?: string) => string };
  run: (action: string, page: Page, inputs: Params, within?: { at?: string }) => Promise<ActionResult>;
  /** What the config says about one action, so a lane can find out how to film it. */
  actionConfig?: (name: string) => ActionConfig | undefined;
  evidence: () => { dir: string; writeManifest: (context: EvidenceContext) => void; readme: () => string | undefined };
  pinEvidence: (context: EvidenceContext | undefined) => void;
  renderVideos: () => string[];
};
