import { equal, match, ok } from "node:assert/strict";
import { afterEach, test } from "node:test";

/** Deriving a path needs the runner's idea of what is running, so this half skips where it is absent. */
const havePlaywright = await import("@playwright/test").then(
  () => true,
  () => false,
);
const { currentContext, slug } = havePlaywright ? await import("./paths.ts") : ({ currentContext: null, slug: null } as never);
const when = { skip: havePlaywright ? false : "needs @playwright/test" };

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

test("a slug is lower case, dash separated, and has no surprises in it", when, () => {
  equal(slug("Back to dashboard #583"), "back-to-dashboard-583");
  equal(slug("A member's résumé"), "a-member-s-resume");
  equal(slug("  spaced   out  "), "spaced-out");
  equal(slug("Already-fine"), "already-fine");
  equal(slug("!!!"), "unnamed");
});

test("a long title is cut at a word, and cut the same way every time", when, () => {
  // Deterministically: no hash, no counter — two runs of the same test must land in the same directory.
  const long = "a very long test title that goes on well past anything worth putting in a file name";
  equal(slug(long), slug(long));
  ok(slug(long).length <= 48);
  ok(!slug(long).endsWith("-"));
  match(slug(long), /^a-very-long-test-title/);
});

test("outside a test it says so rather than inventing a name", when, () => {
  // The CLI drives actions too, and `test.info()` throws there.
  delete process.env.EVIDENCE;
  const context = currentContext();
  equal(context.source, "cli");
  equal(context.test, "adhoc");
  equal(context.cut, "run");
  equal(context.group, "cli/adhoc/run");
});

test("the cut being recorded comes from the environment", when, () => {
  process.env.EVIDENCE = "before";
  equal(currentContext().cut, "before");
  equal(currentContext("action").group, "action/adhoc/before");
});
