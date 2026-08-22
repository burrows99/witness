/**
 * Where the stack under test is, and how to reach into it.
 *
 * One `.env` describes the stack to compose and to the system at once, so a second checkout with
 * its own ports needs no wrapper script.
 */
export { Stack, type ServiceSpec, type StackSpec, type StackStatus } from "./stack.ts";
export { Docker } from "./docker.ts";
export { Workspace } from "./workspace.ts";
