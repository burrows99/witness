import { equal, throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { Stack } from "../environment/stack.ts";
import { resolveSecret } from "./secrets.ts";

const stack = (root = "/nowhere"): Stack => ({ root, env: (service: string, key: string) => `${service}:${key}` }) as unknown as Stack;

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

test("a bare string is its own value", () => {
  equal(resolveSecret("plain", stack()), "plain");
});

test("nothing declared resolves to nothing, not to undefined leaking into a header", () => {
  equal(resolveSecret(undefined, stack()), "");
});

test("containerEnv reads the running container", () => {
  // The one to prefer: a container keeps the values it had when it was created, so the file on disk and
  // the process serving requests can disagree — and the process is the one telling the truth.
  equal(resolveSecret({ containerEnv: { service: "api", key: "ADMIN_KEY" } }, stack()), "api:ADMIN_KEY");
});

test("envFile reads a gitignored KEY=value file, relative to the checkout", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "witness-secret-"));
  writeFileSync(path.join(dir, ".env.local"), 'OTHER=x\nTOKEN="quoted-value"\n');
  equal(resolveSecret({ envFile: { file: ".env.local", key: "TOKEN" } }, stack(dir)), "quoted-value");
  equal(resolveSecret({ envFile: { file: path.join(dir, ".env.local"), key: "OTHER" } }, stack()), "x");
});

test("a missing secret file says which key it was looking for", () => {
  throws(() => resolveSecret({ envFile: { file: ".env.nope", key: "TOKEN" } }, stack("/tmp")), /does not exist \(needs TOKEN\)/);
});

test("env takes it from this process, written either way", () => {
  // The declared shape is `{ "env": "TOKEN" }`; some configs were written `{ "env": { "name": "TOKEN" } }`.
  // Both have to work, because the failure mode of the one that does not is a 403 nobody can explain.
  process.env.WITNESS_TEST_TOKEN = "from-env";
  equal(resolveSecret({ env: "WITNESS_TEST_TOKEN" }, stack()), "from-env");
  equal(resolveSecret({ env: { name: "WITNESS_TEST_TOKEN" } } as never, stack()), "from-env");
  equal(resolveSecret({ env: "NOTHING_SET_HERE" }, stack()), "");
});

test("literal is for the thing that is not actually secret", () => {
  equal(resolveSecret({ literal: "not-a-secret" }, stack()), "not-a-secret");
  equal(resolveSecret({ literal: { value: "not-a-secret" } } as never, stack()), "not-a-secret");
});

test("an unregistered kind names the ones that exist", () => {
  throws(() => resolveSecret({ vault: { path: "x" } } as never, stack()), /no secret provider "vault" — registered: containerEnv, secret, envFile, env, literal/);
});

test("a credential can point at one this description already declares", () => {
  // An `auth` block respelling the same `containerEnv` as the `secrets` entry above it is two places
  // to change and one place to forget — and it was in this repository's own config, twice.
  equal(resolveSecret({ secret: "adminPassword" }, stack(), name => (name === "adminPassword" ? "from the container" : undefined)), "from the container");
});

test("pointing at one that is not declared says so", () => {
  throws(() => resolveSecret({ secret: "nope" }, stack(), () => undefined), /no secret "nope" to point at/);
});
