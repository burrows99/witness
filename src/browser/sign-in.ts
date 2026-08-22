import type { BrowserContext, Page } from "@playwright/test";

import { fill, type SignInConfig } from "../config/index.ts";
import type { Operations } from "../http/operations.ts";
import type { Queries } from "../database/queries.ts";
import type { WebApp } from "./web-app.ts";

/**
 * Magic-link sign-in, described rather than coded.
 *
 * Mint a link through the API, hand the token to the app, let the app authenticate itself. An
 * impersonation link, a passwordless email link and a support "log in as" button are all this shape, so
 * it is worth a config entry instead of a class per product.
 *
 * The minted URL usually points at whatever origin the API is configured with — not necessarily the app
 * this run is driving. The token is kept and the host swapped, which is what makes a second checkout
 * (its own web port) work without touching the API's environment.
 */
export class SignIn {
  private readonly site: WebApp;
  private readonly operations: Operations;
  private readonly queries: Queries;
  private readonly config: SignInConfig;

  constructor(site: WebApp, operations: Operations, queries: Queries, config: SignInConfig) {
    this.site = site;
    this.operations = operations;
    this.queries = queries;
    this.config = config;
  }

  /** The link itself, for a note or for a person to paste into a browser. */
  async link(id: string, origin = this.site.origin): Promise<string> {
    const { url } = await this.operations.call<{ url: string }>(this.config.mint, { id });
    const token = new URL(url).searchParams.get(this.config.tokenParam ?? "token");
    if (!token) throw new Error(`${this.config.mint} returned no ${this.config.tokenParam ?? "token"}`);
    return `${origin}${fill(this.config.landing, { token })}`;
  }

  /** Open the link and wait for the app to have finished authenticating. */
  async signIn(page: Page, id: string, path?: string): Promise<void> {
    await page.goto(await this.link(id));
    const landing = fill(this.config.landing, { token: "" }).split("?")[0];
    await page.waitForURL(u => !u.pathname.startsWith(landing), { timeout: 30_000 });
    if (path) await this.site.goto(page, path);
  }

  /**
   * Exchange a fresh token for a session cookie, without a browser.
   *
   * Hand the result to the API to ask a question AS that user — often the shortest way to answer "what
   * does their own request return", which an admin route can answer differently.
   */
  async session(id: string): Promise<string> {
    const exchange = this.config.exchange;
    if (!exchange) throw new Error("this app's signIn declares no exchange");
    const { url } = await this.operations.call<{ url: string }>(this.config.mint, { id });
    const token = new URL(url).searchParams.get(this.config.tokenParam ?? "token");
    const res = await fetch(this.operations.url(exchange.operation), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) throw new Error(`exchange ${res.status}: ${await res.text()}`);
    const cookie = (res.headers.get("set-cookie") ?? "").match(new RegExp(`${exchange.cookie}=([^;]+)`))?.[1];
    if (!cookie) throw new Error(`exchange returned no ${exchange.cookie} cookie`);
    return cookie;
  }

  /**
   * Put a session straight into a browser context, skipping the landing page.
   *
   * For the cases where visiting the link itself changes what the app does — apps commonly mark a
   * link-minted session as staff-driven and behave differently (suppressed analytics, banners). Pair it
   * with whatever query un-marks the session if the point is to look like an ordinary login.
   */
  async inject(context: BrowserContext, id: string, opts: { origin?: string } = {}): Promise<string> {
    const exchange = this.config.exchange;
    if (!exchange) throw new Error("this app's signIn declares no exchange");
    const value = await this.session(id);
    for (const hook of this.config.afterInject ?? []) {
      this.queries.query(hook.query, { sid: value, sessionId: value, ...(hook.params ?? {}) });
    }
    await context.addCookies([
      {
        name: exchange.cookie,
        value,
        domain: new URL(opts.origin ?? this.site.origin).hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    return value;
  }
}
