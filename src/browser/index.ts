/**
 * Everything that happens in a browser: the apps, their screens, how someone signs in, and the
 * narration that makes a recording watchable.
 */
export { WebApp } from "./web-app.ts";
export { Screen } from "./screen.ts";
export type { Params as ScreenParams } from "./screen.ts";
export { appSurface, type RouteMap, type Screens } from "./surface.ts";
export { describe as describeLocator, type LocatorSpec, locate } from "./locator.ts";
export { SignIn } from "./sign-in.ts";
export { testFor } from "./fixture.ts";
export { beat, caption, markRecordingStart, resetSlideMarks, slide, slideMarks, type SlideMark, typeIn } from "./narration.ts";
