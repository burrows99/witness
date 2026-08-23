import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { Docker } from "./docker.ts";
import { Stack } from "./stack.ts";

const root = (env = "", files: string[] = []): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "witness-stack-"));
  writeFileSync(path.join(dir, ".env"), env);
  for (const file of files) writeFileSync(path.join(dir, file), "");
  return dir;
};

const fakeDocker = (opts: { running?: string[]; publishers?: Record<number, string> } = {}): Docker =>
  new Docker({
    cli: args => {
      if (args.includes("{{.Names}}\t{{.Ports}}")) {
        return Object.entries(opts.publishers ?? {})
          .map(([port, name]) => `${name}\t0.0.0.0:${port}->${port}/tcp`)
          .join("\n");
      }
      return (opts.running ?? []).join("\n");
    },
  });

const answering = (status: number, body = ""): void => {
  globalThis.fetch = (async () => new Response(body, { status }));
};

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const originalCwd = process.cwd();
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  process.chdir(originalCwd);
});

test("readEnvFile reads KEY=value, quoted or not", () => {
  const dir = root('WEB_PORT=3000\nAPI_URL="http://x"\n  SPACED = 5 \nnot a variable\n# comment\n');
  deepEqual(Stack.readEnvFile(path.join(dir, ".env")), { WEB_PORT: "3000", API_URL: "http://x", SPACED: "5" });
});

test("a missing env file means defaults, not a failure", () => {
  deepEqual(Stack.readEnvFile("/nowhere/.env"), {});
});

test("findRoot walks up to the directory holding every marker", () => {
  const dir = root("", ["docker-compose.yml", "package.json"]);
  const deep = path.join(dir, "a", "b");
  mkdirSync(deep, { recursive: true });
  process.chdir(deep);
  // Through realpath: macOS hands out /var/folders paths whose real location is under /private.
  equal(Stack.findRoot(["docker-compose.yml", "package.json"]), realpathSync(dir));
  throws(() => Stack.findRoot(["nothing-like-this"]), /no checkout root above/);
});

test("a service's URL comes from the port, the .env, or an override", () => {
  process.env.WEB_URL = "http://from-the-environment";
  const stack = new Stack({
    root: root("API_PORT=3002\n"),
    docker: fakeDocker(),
    services: {
      web: { port: 3000, urlVar: "WEB_URL" },
      api: { port: 8080, portVar: "API_PORT" },
      plain: { port: 4000 },
      remote: { url: "https://sandbox.example" },
    },
  });
  deepEqual(stack.endpoints, {
    web: "http://from-the-environment",
    api: "http://localhost:3002",
    plain: "http://localhost:4000",
    remote: "https://sandbox.example",
  });
});

test("container names carry the checkout's suffix", () => {
  process.env.WT = "-583";
  const stack = new Stack({
    root: root(),
    docker: fakeDocker(),
    services: { api: { port: 1, container: "acme-api" }, web: { port: 2 } },
  });
  equal(stack.suffix, "-583");
  deepEqual(stack.containers, { api: "acme-api-583" });
});

test("the suffix can come from the same .env compose reads", () => {
  const stack = new Stack({ root: root("WT=-474\n"), docker: fakeDocker(), services: { api: { port: 1, container: "acme-api" } } });
  equal(stack.containers.api, "acme-api-474");
});

test("status: reachable, with its container up", async () => {
  answering(200);
  const stack = new Stack({
    root: root(),
    docker: fakeDocker({ running: ["acme-api"], publishers: { 3000: "acme-api" } }),
    services: { api: { port: 3000, container: "acme-api" } },
  });
  deepEqual(await stack.status(), [
    { name: "api", url: "http://localhost:3000", reachable: true, container: "acme-api", containerUp: true, answering: undefined },
  ]);
});

test("status: a database is asked of docker, not of HTTP", async () => {
  // Postgres answers no HTTP request ever, and reporting a healthy one as DOWN sends whoever is
  // debugging down the wrong path.
  globalThis.fetch = () => {
    throw new Error("a container probe must not make a request");
  };
  const stack = new Stack({
    root: root(),
    docker: fakeDocker({ running: ["acme-postgres"] }),
    services: { postgres: { port: 5432, container: "acme-postgres", probe: "container" } },
  });
  equal((await stack.status())[0].reachable, true);
});

test("status: judged by a container it has not got, the answer is 'cannot tell'", async () => {
  // Not `false`. A board that says DOWN when nothing was asked is indistinguishable from one saying
  // DOWN about something that really is down, and a status board's entire job is being believed.
  globalThis.fetch = () => {
    throw new Error("a container probe must not make a request");
  };
  const stack = new Stack({ root: root(), docker: fakeDocker(), services: { redis: { port: 6380, probe: "container" } } });
  equal((await stack.status())[0].reachable, undefined);
});

test("status: another project's container on our port is neither up nor down", async () => {
  answering(200);
  const stack = new Stack({
    root: root(),
    docker: fakeDocker({ running: ["someone-elses-thing"], publishers: { 8080: "someone-elses-thing" } }),
    services: { search: { port: 8080, container: "acme-search" } },
  });
  const [row] = await stack.status();
  match(row.answering!, /someone-elses-thing publishes this port, not acme-search/);
});

test("status: our own container publishing our own port says nothing", async () => {
  answering(200);
  const stack = new Stack({
    root: root(),
    docker: fakeDocker({ running: ["acme-api"], publishers: { 3000: "acme-api" } }),
    services: { api: { port: 3000, container: "acme-api" } },
  });
  equal((await stack.status())[0].answering, undefined);
});

test("status: a service with no container is recognised by what it answers", async () => {
  answering(404, "not the thing you are looking for");
  const stack = new Stack({
    root: root(),
    docker: fakeDocker(),
    services: { traces: { port: 3100, probe: { path: "/api/public/health", status: 200 } } },
  });
  const [row] = await stack.status();
  equal(row.reachable, false);
  match(row.answering!, /something that is not traces answers http:\/\/localhost:3100/);
});

test("status: an identity probe that matches passes", async () => {
  answering(200, '{"service":"acme-search"}');
  const stack = new Stack({
    root: root(),
    docker: fakeDocker(),
    services: { search: { port: 8080, probe: { path: "/_health", contains: "acme-search" } } },
  });
  const [row] = await stack.status();
  equal(row.reachable, true);
  equal(row.answering, undefined);
});

test("status: nothing listening is DOWN, not NOT OURS", async () => {
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  });
  const stack = new Stack({ root: root(), docker: fakeDocker(), services: { web: { port: 3000 } } });
  const [row] = await stack.status();
  equal(row.reachable, false);
  equal(row.answering, undefined);
});

test("env reads a variable out of the service's container", () => {
  const stack = new Stack({
    root: root(),
    docker: new Docker({ cli: args => (args.includes("printenv") ? "from-the-container" : "") }),
    services: { api: { port: 1, container: "acme-api" } },
  });
  equal(stack.env("api", "KEY"), "from-the-container");
  throws(() => stack.env("web", "KEY"), /no container declared for service "web"/);
});

test("a service can be declared as somebody else's", () => {
  const stack = new Stack({
    root: root(),
    docker: fakeDocker(),
    services: { api: { port: 1, kind: "in-house" }, billing: { url: "https://x", kind: "third-party" } },
  });
  ok(stack.endpoints.billing.startsWith("https://"));
});

test("a service that publishes nothing has no URL, and is judged by its container", () => {
  // A queue worker or a migration container answers no HTTP request ever. Inventing
  // `http://localhost:undefined` for it made every command that asks the stack anything throw
  // `Invalid URL` — including `help`, against a config generated straight from a compose file.
  equal(Stack.endpoint({ container: "acme-worker" }, {}), "");
  equal(Stack.endpoint({ port: 4000 }, {}), "http://localhost:4000");
  // The compose `.env` wins over the default, which is the whole point of `portVar`.
  equal(Stack.endpoint({ port: 4000, portVar: "API_PORT" }, { API_PORT: "4100" }), "http://localhost:4100");
  equal(Stack.endpoint({ port: 4000, url: "https://staging.example" }, {}), "https://staging.example");
});
