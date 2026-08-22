import type { Page } from "@playwright/test";

/**
 * A web app in the browser: where it is, and how to get to a page of it.
 *
 * The base every app-under-test composes. It knows nothing about routes — those belong to {@link Screen}
 * subclasses, one per screen a person actually visits, so a spec reads as a path through the product
 * instead of a list of URLs.
 */
export class WebApp {
  private readonly origin_: () => string;

  constructor(origin: string | (() => string)) {
    this.origin_ = typeof origin === "function" ? origin : () => origin;
  }

  get origin(): string {
    return this.origin_();
  }

  url(path = "/"): string {
    return `${this.origin}${path}`;
  }

  goto(page: Page, path = "/", opts?: Parameters<Page["goto"]>[1]): Promise<unknown> {
    return page.goto(this.url(path), opts);
  }
}
