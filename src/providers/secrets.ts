import * as fs from "node:fs";
import * as path from "node:path";

import type { Stack } from "../environment/stack.ts";
import { Registry } from "./registry.ts";

/**
 * Where a credential comes from.
 *
 * Never the config file itself: a system lives in a repo, and a repo is the wrong place for a secret.
 * The config says WHERE to look, and a provider does the looking.
 */
export type SecretSource =
  | string
  | { containerEnv: { service: string; key: string } }
  | { envFile: { file: string; key: string } }
  | { env: string }
  | { literal: string };

export type SecretProvider = (spec: unknown, stack: Stack) => string;

export const secretProviders = new Registry<SecretProvider>("secret")
  /**
   * A variable in a RUNNING container. The one to prefer: a container keeps the values it had when it
   * was created, so a file on disk and the process serving requests can disagree — and the process is
   * the one telling the truth.
   */
  .register("containerEnv", (spec, stack) => {
    const { service, key } = spec as { service: string; key: string };
    return stack.env(service, key);
  })
  /** A gitignored `KEY=value` file — where shared third-party credentials usually live. */
  .register("envFile", (spec, stack) => {
    const { file, key } = spec as { file: string; key: string };
    const at = path.isAbsolute(file) ? file : path.join(stack.root, file);
    if (!fs.existsSync(at)) throw new Error(`secret file ${at} does not exist (needs ${key})`);
    const value = (fs.readFileSync(at, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "").trim();
    return value.replace(/^["']|["']$/g, "");
  })
  /**
   * The system's own environment, for a one-off run.
   *
   * `{ "env": "TOKEN" }` or `{ "env": { "name": "TOKEN" } }`: the type says the first, some configs were
   * written with the second, and a secret that silently resolves to "" is a 403 nobody can explain.
   */
  .register("env", (spec) => process.env[typeof spec === "string" ? spec : String((spec as { name?: string }).name)] ?? "")
  /** A literal — only ever right for something that is not actually secret. */
  .register("literal", (spec) => (typeof spec === "string" ? spec : ((spec as { value?: string }).value ?? "")));

/** Resolve any secret spec. A bare string is a literal. */
export function resolveSecret(spec: SecretSource | undefined, stack: Stack): string {
  if (spec === undefined) return "";
  if (typeof spec === "string") return spec;
  const [kind, value] = Object.entries(spec)[0] as [string, unknown];
  return secretProviders.get(kind)(value, stack);
}
