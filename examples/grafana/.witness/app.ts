import { beat, caption, slide, System, testFor } from "../../../src/index.ts";

/** The product this project describes. */
export const app = System.find();

/** The runner, with this project's identities already in every browser context it opens. */
export const test = testFor(app);

export { expect } from "@playwright/test";
export { beat, caption, slide };
