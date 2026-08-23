import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { Workspace } from "./workspace.ts";

const originalCwd = process.cwd();
afterEach(() => process.chdir(originalCwd));

/** A project with a `.witness/` in it, and a nested directory to run from. */
const project = (opts: { config?: string; nested?: string } = {}): { root: string; dir: string; nested: string } => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "witness-workspace-")));
  const dir = path.join(root, ".witness");
  mkdirSync(dir, { recursive: true });
  if (opts.config !== undefined) writeFileSync(path.join(dir, opts.config), "{}");
  const nested = path.join(root, opts.nested ?? "apps/web");
  mkdirSync(nested, { recursive: true });
  return { root, dir, nested };
};

test("the nearest .witness above the working directory wins", () => {
  // Found the way git finds a repository: from where you are, upward, first one.
  const { root, dir, nested } = project({ config: "config.jsonc" });
  const workspace = Workspace.find({ from: nested });
  equal(workspace.dir, dir);
  equal(workspace.configFile, path.join(dir, "config.jsonc"));
  equal(workspace.root, root);
  equal(workspace.found, ".witness");
});

test("nearest means nearest — a nested project gets its own", () => {
  const outer = project({ config: "config.jsonc" });
  const inner = path.join(outer.root, "packages", "inner");
  mkdirSync(path.join(inner, ".witness"), { recursive: true });
  equal(Workspace.find({ from: inner }).dir, path.join(inner, ".witness"));
  equal(Workspace.find({ from: path.join(outer.root, "apps", "web") }).dir, outer.dir);
});

test("nothing above the working directory is an error that says what to do", () => {
  const empty = realpathSync(mkdtempSync(path.join(tmpdir(), "witness-none-")));
  throws(() => Workspace.find({ from: empty }), /no \.witness\/ in .* or any directory above it/);
  throws(() => Workspace.find({ from: empty }), /Run `witness init` to make one, or pass --config <file>/);
});

test("the directory names its own checkout: the parent", () => {
  const { root, nested } = project({ config: "config.jsonc" });
  equal(Workspace.find({ from: nested }).root, root);
});

test("a description kept somewhere else does not name a checkout, and says so by not naming one", () => {
  // Which is why `root` markers still exist: that layout has to find the checkout another way.
  const workspace = Workspace.find({ config: "/somewhere/harness/acme.config.json" });
  equal(workspace.dir, "/somewhere/harness");
  equal(workspace.root, undefined);
  equal(workspace.found, "--config");
});

test("an explicit config wins over everything, and resolves against where you are", () => {
  const { root, nested } = project({ config: "config.jsonc" });
  const workspace = Workspace.find({ config: "other/acme.json", from: nested, env: { WITNESS_CONFIG: "ignored", WITNESS_DIR: "ignored" } });
  equal(workspace.configFile, path.join(nested, "other/acme.json"));
  ok(!workspace.configFile.startsWith(path.join(root, ".witness")));
});

test("the environment can name the file, or the directory", () => {
  const { root, dir, nested } = project({ config: "config.jsonc" });
  equal(Workspace.find({ from: nested, env: { WITNESS_CONFIG: path.join(dir, "config.jsonc") } }).found, "WITNESS_CONFIG");
  const byDir = Workspace.find({ from: nested, env: { WITNESS_DIR: dir } });
  equal(byDir.found, "WITNESS_DIR");
  equal(byDir.dir, dir);
  equal(byDir.root, root);
});

test("config.jsonc is preferred, config.json is understood", () => {
  const jsonOnly = project({ config: "config.json" });
  equal(Workspace.find({ from: jsonOnly.nested }).configFile, path.join(jsonOnly.dir, "config.json"));

  const both = project({ config: "config.json" });
  writeFileSync(path.join(both.dir, "config.jsonc"), "{}");
  equal(Workspace.find({ from: both.nested }).configFile, path.join(both.dir, "config.jsonc"));

  // An empty directory still answers with the name to create, rather than with nothing.
  const empty = project();
  equal(Workspace.find({ from: empty.nested }).configFile, path.join(empty.dir, "config.jsonc"));
});

test("everything witness reads and writes resolves inside the directory", () => {
  const { dir, nested } = project({ config: "config.jsonc" });
  const workspace = Workspace.find({ from: nested });
  equal(workspace.resolve("artifacts"), path.join(dir, "artifacts"));
  equal(workspace.resolve(), dir);
  // Except what says otherwise outright.
  equal(workspace.resolve("/etc/hosts"), "/etc/hosts");
  // …and reaching outside is possible, but has to be said.
  equal(workspace.resolve("../.env"), path.join(path.dirname(dir), ".env"));
});

test("create writes the directory and its files, and never overwrites one", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "witness-create-")));
  const first = Workspace.create(root, { "config.jsonc": "{}", ".gitignore": "artifacts/\n" });
  deepEqual(first.written.map(f => path.basename(f)).sort(), [".gitignore", "config.jsonc"]);
  equal(first.workspace.dir, path.join(root, ".witness"));
  equal(first.workspace.root, root);

  // Run twice, nothing is lost — the second run is a report, not an overwrite.
  const again = Workspace.create(root, { "config.jsonc": "REPLACED", ".gitignore": "REPLACED" });
  deepEqual(again.written, []);
  equal(readFileSync(path.join(root, ".witness", "config.jsonc"), "utf8"), "{}");
});

test("the name is one name, and it is the same everywhere", () => {
  equal(Workspace.DIRECTORY, ".witness");
  deepEqual(Workspace.CONFIG_NAMES, ["config.jsonc", "config.json"]);
});
