/** The product description: its shape, and how it is read. */
export * from "./schema.ts";
export { fill, loadConfig, reach, withoutComments } from "./load.ts";
export { normalise, qualify, scoped } from "./normalise.ts";
export { TypeSource, type TypeField, type TypeModel } from "./types.ts";
export * from "./explore.ts";
