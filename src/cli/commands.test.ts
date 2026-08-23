import { equal } from "node:assert/strict";
import { afterEach, test } from "node:test";

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

afterEach(() => {
  process.exitCode = undefined;
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
