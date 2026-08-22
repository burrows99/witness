import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import { appSurface } from "./surface.ts";
import { WebApp } from "./web-app.ts";

test("a route becomes a screen with a URL", () => {
  const app = appSurface(() => "http://localhost:3000", { dashboard: "/", order: "/orders/{orderId}" });
  equal(app.dashboard.url(), "http://localhost:3000/");
  equal(app.order.url({ orderId: "1234" }), "http://localhost:3000/orders/1234");
});

test("where the app is, is asked for each time — a worktree resolves its own ports", () => {
  let port = 3000;
  const app = appSurface(() => `http://localhost:${port}`, { dashboard: "/" });
  port = 3100;
  equal(app.dashboard.url(), "http://localhost:3100/");
});

test("an app knows its origin and can build a path it has no screen for", () => {
  const app = new WebApp("http://localhost:3000");
  equal(app.origin, "http://localhost:3000");
  equal(app.url(), "http://localhost:3000/");
  equal(app.url("/anything"), "http://localhost:3000/anything");
});

test("goto sends the page to the screen's URL", async () => {
  const went: string[] = [];
  const page = { goto: async (url: string) => void went.push(url) } as never;
  const app = appSurface(() => "http://localhost:3000", { order: "/orders/{orderId}" });
  await app.order.open(page, { orderId: "9" });
  await app.goto(page, "/elsewhere");
  deepEqual(went, ["http://localhost:3000/orders/9", "http://localhost:3000/elsewhere"]);
});

test("the surface is the app itself, with screens hung off it", () => {
  const app = appSurface(() => "http://x", { dashboard: "/" });
  ok(app instanceof WebApp);
});
