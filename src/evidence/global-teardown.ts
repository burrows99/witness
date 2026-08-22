import { teardownFor } from "./render.ts";

/**
 * The test runner's `globalTeardown`, for whatever system `WITNESS_CONFIG` names.
 *
 * A runner wants a FILE path here, not a function, which is the only reason this exists — and why the
 * config it should read comes from the environment rather than an argument. Point a runner at this and
 * every run turns its recordings into videos, with nothing product-specific in between.
 */
export default teardownFor(process.env.WITNESS_CONFIG ?? "");
