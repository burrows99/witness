import { deepEqual, equal, rejects } from "node:assert/strict";
import { afterEach, test } from "node:test";

import { HttpApi } from "../http/client.ts";
import { Operations } from "../http/operations.ts";
import { Trace } from "../diagnostics/trace.ts";
import { commandsFor } from "./commands.ts";
import type { Report } from "../diagnostics/drift.ts";
import type { Stack } from "../environment/stack.ts";
import type { System } from "../system.ts";

const stack = { suffix: "", root: "/checkout", status: async () => [] } as unknown as Stack;

/**
 * A system with the parts `commandsFor` reads, and nothing else.
 *
 * Cast once, here, rather than at each call site: `System` is the composite root and standing one up
 * would need a description, a stack and a browser. The cast is survivable in a way the one in
 * `run.test.ts` was not — a field this omits and `commandsFor` later reads is `undefined` at the
 * moment the verb runs, which throws in front of whoever added it, rather than being quietly declared
 * optional in the production type.
 */
const systemReporting = (report: Report): System =>
  ({
    config: { name: "acme" },
    stack,
    trace: undefined,
    renderVideos: () => [],
    hasApi: false,
    hasDatabase: false,
    actions: { names: [] },
    added: {},
    checkDrift: async () => ({ ...report, rendered: report.summary }),
  }) as unknown as System;

const report = (ok: boolean): Report => ({ ok, findings: [], checked: 1, skipped: 0, summary: ok ? "all 1 claims still hold" : "1 of 1 claims no longer hold" });

/** Run a command, keeping what it printed and whatever it did to the exit code. */
const run = async (report: Report): Promise<{ printed: string; exitCode: typeof process.exitCode }> => {
  const written: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const before = process.exitCode;
  process.stdout.write = (text: string) => {
    written.push(text);
    return true;
  };
  try {
    await commandsFor(systemReporting(report)).run(["check", "drift"]);
    return { printed: written.join(""), exitCode: process.exitCode };
  } finally {
    process.stdout.write = stdout;
    // Restored, or this suite's own exit code is whatever the last case here asserted.
    process.exitCode = before;
  }
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  process.exitCode = undefined;
  globalThis.fetch = originalFetch;
});

test("a description that no longer holds exits 1, so this can gate a pipeline", async () => {
  // The line under test is one `if` in `commands.ts`, and deleting it left 424 tests passing: nothing
  // ran the verb, so the summary's promise — "so this can gate a pipeline" — was a comment. A drift
  // check that reports breakage and exits 0 is a gate that looks active and is not.
  const { printed, exitCode } = await run(report(false));
  equal(exitCode, 1);
  // Set rather than exited, so the report is flushed first: an exit code with no report is a red
  // nobody can act on.
  equal(printed.trim(), "1 of 1 claims no longer hold");
});

test("…and a description that still holds leaves the exit code alone", async () => {
  const { printed, exitCode } = await run(report(true));
  equal(exitCode, undefined);
  equal(printed.trim(), "all 1 claims still hold");
});

/**
 * A system whose API is the real `Operations`, over a fetch that keeps what it was asked.
 *
 * The client is the part under test here: the defect was never in it — it has resolved these names all
 * along — but in the wiring that reached past it, so a fake api would pass against the bug.
 */
const systemCalling = (): { system: System; seen: { url: string; method: string; body?: string }[] } => {
  const seen: { url: string; method: string; body?: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method ?? "GET"), ...(init.body === undefined ? {} : { body: String(init.body) }) });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const api = new Operations(
    new HttpApi("http://localhost:5001", () => ({}), new Trace()),
    stack,
    { service: "api", operations: { listProjects: { path: "/api/graph/project/list" }, getReport: { path: "/api/reports/{reportId}" } } },
    new Trace(),
  );
  return {
    seen,
    system: {
      config: { name: "acme" },
      stack,
      trace: undefined,
      renderVideos: () => [],
      hasApi: true,
      hasDatabase: false,
      actions: { names: [] },
      added: {},
      api,
    } as unknown as System,
  };
};

/** Run a command against a system, keeping what it printed. */
const ran = async (system: System, argv: string[]): Promise<string> => {
  const written: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  process.stdout.write = (text: string) => {
    written.push(text);
    return true;
  };
  try {
    await commandsFor(system).run(argv);
    return written.join("");
  } finally {
    process.stdout.write = stdout;
  }
};

test("api get calls a declared operation by name, with the key=value parameters action run takes", async () => {
  // The names in the config were unreachable from the command line: the verb went straight to the raw
  // request, so `api get getReport` was concatenated onto the base URL as
  // `http://localhost:5001getReport` and came back as `Failed to parse URL from` a string nobody typed.
  const { system, seen } = systemCalling();
  await ran(system, ["api", "get", "getReport", "reportId=7"]);
  deepEqual(seen, [{ url: "http://localhost:5001/api/reports/7", method: "GET" }]);
});

test("…and a path is still a path, with the JSON body that follows it", async () => {
  const { system, seen } = systemCalling();
  await ran(system, ["api", "post", "/v1/things", '{"name":"x"}']);
  deepEqual(seen, [{ url: "http://localhost:5001/v1/things", method: "POST", body: '{"name":"x"}' }]);
});

test("something that is neither is named as neither, before anything is sent", async () => {
  const { system, seen } = systemCalling();
  await rejects(
    () => ran(system, ["api", "get", "health"]),
    /no such operation "health" — declared: listProjects, getReport… \(paths start with \/\)/,
  );
  deepEqual(seen, []);
});
