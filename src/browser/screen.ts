import type { Page } from "@playwright/test";

import { fill } from "../config/index.ts";
import type { WebApp } from "./web-app.ts";

/**
 * One screen of an app: a route, and whatever a spec needs to do on it.
 *
 * The route may take arguments — `"/orders/{orderId}"` — which go in by NAME rather than by position,
 * because a route declared in a config file has no signature for a reader to check against:
 * `open(page, { orderId })` says what it is doing and `open(page, a, b)` does not.
 *
 * Screens that are only a route are generated from the config. Subclass this one when a screen has real
 * behaviour — a form with steps, a picker to drive, a third party's iframe.
 */
export class Screen {
  readonly app: WebApp;
  readonly route: string;

  constructor(app: WebApp, route: string) {
    this.app = app;
    this.route = route;
  }

  path(params: Params = {}): string {
    return fill(this.route, params);
  }

  url(params: Params = {}): string {
    return this.app.url(this.path(params));
  }

  open(page: Page, params: Params = {}, opts?: Parameters<Page["goto"]>[1]): Promise<unknown> {
    return this.app.goto(page, this.path(params), opts);
  }
}

export type Params = Record<string, unknown>;
