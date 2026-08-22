import { Screen } from "./screen.ts";
import { WebApp } from "./web-app.ts";

/** Screen name → route. `{placeholders}` make it a route that takes arguments. */
export type RouteMap = Record<string, string>;

export type Screens<R extends RouteMap> = { [K in keyof R]: Screen };

/**
 * Build an app's surface: the app itself, plus one {@link Screen} per declared route.
 *
 * Declaring screens as data is what removes the file-per-page boilerplate — a screen that is only a URL
 * needs no class. The ones with behaviour subclass `Screen` and are attached over the generated one.
 */
export function appSurface<R extends RouteMap>(origin: () => string, routes: R): WebApp & Screens<R> {
  const app = new WebApp(origin) as WebApp & Screens<R>;
  for (const [name, route] of Object.entries(routes)) {
    (app as Record<string, unknown>)[name] = new Screen(app, route);
  }
  return app;
}
