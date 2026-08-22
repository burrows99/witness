import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { stubProviders, type StubConfig, type StubServer } from "./stubs.ts";
import { Trace } from "../diagnostics/trace.ts";

const started: StubServer[] = [];
after(async () => {
  for (const stub of started) await stub.close();
});

/** A port nobody is using this second: a stub is declared on a real one, so the config decides it. */
const freePort = async (): Promise<number> =>
  new Promise(resolve => {
    const probe = createServer();
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const start = async (config: Omit<StubConfig, "port">, root = "/", trace?: Trace): Promise<StubServer> => {
  const stub = await stubProviders.get("http")("vendor", { ...config, port: await freePort() }, root, trace);
  started.push(stub);
  return stub;
};

const at = (stub: StubServer, path: string): string => `${stub.url}${path}`;

test("a declared route answers with its declared JSON", async () => {
  const stub = await start({ routes: [{ path: "/v1/health", json: { ok: true } }] });
  const res = await fetch(at(stub, "/v1/health"));
  equal(res.status, 200);
  deepEqual(await res.json(), { ok: true });
});

test("a path captures its segments, and the answer can use them", async () => {
  const stub = await start({ routes: [{ path: "/v1/appointments/{id}", json: { id: "{id}", url: "{origin}/v1/appointments/{id}" } }] });
  deepEqual(await (await fetch(at(stub, "/v1/appointments/abc"))).json(), {
    id: "abc",
    url: `${stub.url}/v1/appointments/abc`,
  });
});

test("what the app SENT is the claim most of these exist to make", async () => {
  // "The app called out with this payload" is a claim about a request nobody can otherwise see.
  const stub = await start({ routes: [{ method: "POST", path: "/v1/send", json: { queued: true } }] });
  await fetch(at(stub, "/v1/send"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "someone@example.com" }) });
  deepEqual(stub.requests.map(r => [r.method, r.path, r.body]), [["POST", "/v1/send", { to: "someone@example.com" }]]);
});

test("a form-encoded body is understood too — not every vendor speaks JSON", async () => {
  const stub = await start({ routes: [{ method: "POST", path: "/", json: { ok: true } }] });
  await fetch(at(stub, "/"), { method: "POST", body: new URLSearchParams({ Action: "SendEmail", Destination: "x@example.com" }) });
  deepEqual(stub.requests[0].body, { Action: "SendEmail", Destination: "x@example.com" });
});

test("append builds a collection the spec can read back", async () => {
  const stub = await start({
    state: { sent: [] },
    routes: [{ method: "POST", path: "/v1/send", append: { to: "sent", item: { to: "{body.to}", id: "msg-{seq}" } } }],
  });
  await fetch(at(stub, "/v1/send"), { method: "POST", body: JSON.stringify({ to: "a@example.com" }) });
  await fetch(at(stub, "/v1/send"), { method: "POST", body: JSON.stringify({ to: "b@example.com" }) });
  deepEqual(stub.collection("sent"), [
    { to: "a@example.com", id: "msg-1" },
    { to: "b@example.com", id: "msg-2" },
  ]);
  // …and the appended item is what the caller got back, without having to declare it twice.
  deepEqual(stub.requests.length, 2);
});

test("find looks one up, and a miss is a 404 rather than a lie", async () => {
  const stub = await start({
    state: { bookings: [{ id: "1", status: "booked" }] },
    routes: [{ path: "/v1/bookings/{id}", find: { in: "bookings", where: { id: "{id}" } } }],
  });
  deepEqual(await (await fetch(at(stub, "/v1/bookings/1"))).json(), { id: "1", status: "booked" });
  const missing = await fetch(at(stub, "/v1/bookings/9"));
  equal(missing.status, 404);
  match(JSON.stringify(await missing.json()), /no bookings matching/);
});

test("update changes the item find matched", async () => {
  const stub = await start({
    state: { bookings: [{ id: "1", status: "booked" }] },
    routes: [{ method: "POST", path: "/v1/bookings/{id}/cancel", find: { in: "bookings", where: { id: "{id}" } }, update: { status: "cancelled" } }],
  });
  await fetch(at(stub, "/v1/bookings/1/cancel"), { method: "POST" });
  deepEqual(stub.collection("bookings"), [{ id: "1", status: "cancelled" }]);
});

test("set writes top-level state", async () => {
  const stub = await start({ routes: [{ method: "PUT", path: "/v1/mode", set: { mode: "{body.mode}" } }] });
  await fetch(at(stub, "/v1/mode"), { method: "PUT", body: JSON.stringify({ mode: "degraded" }) });
  equal(stub.state.mode, "degraded");
});

test("a page that is HTML stays in a file that is HTML", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "witness-stub-"));
  writeFileSync(path.join(root, "page.html"), "<h1>Booking {id}</h1>");
  const stub = await start({ routes: [{ path: "/book/{id}", html: "page.html" }] }, root);
  const res = await fetch(at(stub, "/book/42"));
  equal(res.headers.get("content-type"), "text/html");
  equal(await res.text(), "<h1>Booking 42</h1>");
});

test("a route nobody declared says so, naming the stub", async () => {
  const stub = await start({ routes: [] });
  const res = await fetch(at(stub, "/v1/nope"));
  equal(res.status, 404);
  match(JSON.stringify(await res.json()), /stub .*vendor.* declares no route for GET \/v1\/nope/);
});

test("the method is part of the match", async () => {
  const stub = await start({ routes: [{ method: "POST", path: "/v1/things", json: { made: true } }] });
  equal((await fetch(at(stub, "/v1/things"))).status, 404);
  equal((await fetch(at(stub, "/v1/things"), { method: "POST" })).status, 200);
});

test("waitFor gives up with a message that says what it saw", async () => {
  const stub = await start({ state: { sent: [] }, routes: [] });
  await rejects(
    () => stub.waitFor("sent", () => false, { timeout: 10, label: "an email to nobody" }),
    /stub "vendor": nothing in sent matched an email to nobody within 10ms \(0 seen\)/,
  );
});

test("waitFor returns the item once it arrives", async () => {
  const stub = await start({ state: { sent: [] }, routes: [{ method: "POST", path: "/send", append: { to: "sent", item: { to: "{body.to}" } } }] });
  setTimeout(() => void fetch(at(stub, "/send"), { method: "POST", body: JSON.stringify({ to: "late@example.com" }) }), 20);
  deepEqual(await stub.waitFor<{ to: string }>("sent", item => item.to === "late@example.com", { timeout: 5_000 }), { to: "late@example.com" });
});

test("what the app should be pointed at is the stub's business, not the spec's", async () => {
  // Usually not localhost: the app is in a container and the stub is on the host.
  const chosen = await freePort();
  const stub = await stubProviders.get("http")("vendor", { port: chosen, reachableAs: "http://host.docker.internal:{port}", routes: [] }, "/");
  started.push(stub);
  equal(stub.reachableAs, `http://host.docker.internal:${chosen}`);
  ok(stub.url.startsWith("http://localhost:"));
});

test("every request reaches the trace, so a stub's traffic reads like everything else", async () => {
  const trace = new Trace();
  const stub = await start({ routes: [{ path: "/v1/ping", json: {} }] }, "/", trace);
  await fetch(at(stub, "/v1/ping"));
  match(JSON.stringify(trace.last), /stub:vendor/);
});
