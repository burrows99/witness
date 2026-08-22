/**
 * A system for whatever product a config file describes.
 *
 * `System.fromConfig(file)` is the entry point; everything else here is the vocabulary that config is
 * written in. Nothing in this folder knows what any particular product is — see `README.md`.
 */
export { System, type AppSurface, type CastEntry } from "./system.ts";
export { fill, loadConfig } from "./config/index.ts";
export type {
  AppConfig,
  CliGroupConfig,
  DatabaseConfig,
  SystemConfig,
  IdentityConfig,
  RunnerConfig,
  SignInConfig,
} from "./config/index.ts";
export * from "./environment/index.ts";
export * from "./http/index.ts";
export * from "./database/index.ts";
export * from "./browser/index.ts";
export * from "./actions/index.ts";
export * from "./evidence/index.ts";
export * from "./diagnostics/index.ts";
export * from "./cli/index.ts";
export * from "./providers/index.ts";
