/** What a product can DO — step lists in the config, each run reporting everything it did. */
export { Actions, type ActionConfig, type ActionResult, type StepConfig, type StepResult } from "./engine.ts";
export { parseRunArgs, runActions, type RunRequest, type RunResult } from "./run.ts";
