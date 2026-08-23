import { deepEqual, equal, match, ok } from "node:assert/strict";
import type { execFileSync } from "node:child_process";
import { test } from "node:test";

import { Compose } from "./compose.ts";

/**
 * What `docker compose config --no-interpolate --format json` gives back for this repo's own stack.
 *
 * **Alphabetical**, because that is what compose does, and it is load-bearing rather than tidiness:
 * this fixture used to list `postgres` before `mariadb` — an order compose never produces — so the one
 * bug the ordering rule exists for could not happen in it. `depends_on` is here for the same reason,
 * in the object form compose normalises `[postgres, mailpit]` into.
 */
const STACK = {
  gitea: {
    image: "gitea/gitea:1.21.11",
    container_name: "witness-gitea",
    ports: ["${GITEA_PORT:-3020}:3000"],
    depends_on: { postgres: { condition: "service_started", required: true } },
    environment: { GITEA__database__USER: "gitea", GITEA__database__PASSWD: "${POSTGRES_CREDENTIAL:-x}" },
  },
  // A second database, and no `container_name`: both of the things a real stack does that this used
  // to be silent about. Nothing in the file says anything needs it — which is what makes it the wrong
  // answer to "what does `db sql` mean", and it sorts first.
  mariadb: {
    image: "mariadb:11.4",
    ports: ["${MARIADB_PORT:-3307}:3306"],
    environment: { MARIADB_DATABASE: "witness", MARIADB_USER: "witness", MARIADB_PASSWORD: "${MARIADB_CREDENTIAL:-x}" },
  },
  postgres: {
    image: "postgres:17",
    container_name: "witness-postgres",
    ports: ["${POSTGRES_PORT:-5441}:5432"],
    environment: { POSTGRES_DB: "gitea", POSTGRES_USER: "gitea", POSTGRES_PASSWORD: "${POSTGRES_CREDENTIAL:-x}" },
  },
  redis: { image: "redis:7-alpine", ports: ["${REDIS_PORT:-6380}:6379"] },
  worker: { build: { context: "." }, container_name: "witness-worker" },
};

const translate = (services: Record<string, unknown> = STACK, project = "witness") =>
  Compose.translate(services as Parameters<typeof Compose.translate>[0], project).services;

test("a port mapping keeps the variable that sets it", () => {
  // `--no-interpolate` exists for this line. With the value substituted the variable name is gone,
  // and `portVar` is the whole reason a second checkout can run its own ports without a wrapper.
  deepEqual(Compose.published(["${GITEA_PORT:-3020}:3000"]), [{ variable: "GITEA_PORT", port: 3020, target: 3000 }]);
  deepEqual(Compose.published(["8025:8025"]), [{ port: 8025, target: 8025 }]);
  deepEqual(Compose.published(["127.0.0.1:5432:5432"]), [{ port: 5432, target: 5432 }]);
  deepEqual(Compose.published(undefined), []);
});

test("every published port comes back, not just the first", () => {
  // This read `ports[0]` and stopped. A container publishing a UI on one port and its API on the
  // other — the ordinary dev-mode image — came back described as the UI, and the API was gone.
  deepEqual(Compose.published(["3000:3000", "5001:5001"]), [
    { port: 3000, target: 3000 },
    { port: 5001, target: 5001 },
  ]);
  // Each mapping keeps its own variable: `portVar` has to work per port or the second checkout moves
  // half a container.
  deepEqual(Compose.published(["${UI_PORT:-3000}:3000", "${API_PORT:-5001}:5001"]), [
    { variable: "UI_PORT", port: 3000, target: 3000 },
    { variable: "API_PORT", port: 5001, target: 5001 },
  ]);
  // The long form, which is where compose puts a port somebody named.
  deepEqual(Compose.published([{ published: "5001", target: 5001, name: "api" }]), [{ port: 5001, target: 5001, name: "api" }]);
});

test("a container publishing two ports is described twice, on one container", () => {
  // The half that was invisible. `witness api get` and every `check` in an action are for the API,
  // and it was not in the file at all — while `init` exited 0 saying it had read the service.
  const services = translate({ demo: { image: "nginx:latest", container_name: "demo", ports: ["3000:3000", "5001:5001"] } }, "demo");
  deepEqual(services.demo, { port: 3000, container: "demo" });
  // The SAME container, deliberately: a service holds one port, so this is the only shape there is.
  deepEqual(services["demo-5001"], { port: 5001, container: "demo" });
  // Named by the port number, because nothing in the file said what the port was for. A role guessed
  // off the image would be the kind of wrong a generated file cannot be argued with about.
  deepEqual(Object.keys(services), ["demo", "demo-5001"]);
});

test("a port compose named is named that, and its variable still moves it", () => {
  const services = translate(
    { app: { image: "acme/app", container_name: "acme", ports: ["3000:3000", { published: "${API_PORT:-5001}", target: 5001, name: "api" }] } },
    "acme",
  );
  deepEqual(services["app-api"], { port: 5001, portVar: "API_PORT", container: "acme" });
});

test("a name compose already uses is not overwritten by a derived one", () => {
  // `app-api` is a real service in this file. Taking the name would describe one of them twice and
  // the other not at all, so the derived entry falls back to the port number.
  const services = translate(
    {
      app: { image: "acme/app", container_name: "acme-app", ports: ["3000:3000", { published: "5001", target: 5001, name: "api" }] },
      "app-api": { image: "acme/api", container_name: "acme-api", ports: ["5002:5002"] },
    },
    "acme",
  );
  equal(services["app-api"].container, "acme-api");
  deepEqual(services["app-5001"], { port: 5001, container: "acme-app" });
});

test("a service built here is ours; one pulled by tag says nothing either way", () => {
  const services = translate();
  equal(services.worker.kind, "in-house");
  // NOT `third-party`. A stack that builds its images in CI and pulls them back by tag would be
  // labelled somebody else's from end to end, which inverts the meaning of the field for all of it.
  equal(services.postgres.kind, undefined);
});

test("a service that publishes no port can only be asked of docker", () => {
  const services = translate();
  equal(services.worker.probe, "container");
  // One that does publish a port, and speaks HTTP on it, answers the default probe.
  equal(services.gitea.probe, undefined);
});

test("a published port is not an HTTP port", () => {
  // All three publish one, and nothing at `http://localhost:5441` will ever answer an HTTP request,
  // so the default probe reports a perfectly healthy database as DOWN forever.
  const services = translate();
  equal(services.postgres.probe, "container");
  equal(services.mariadb.probe, "container");
  equal(services.redis.probe, "container");
  ok(Compose.speaksHttp("grafana/grafana:13.2.0"));
  ok(!Compose.speaksHttp("bitnami/postgresql:16"));
});

test("the second port of an image the first port made look like an app", () => {
  // Reading every mapping is what makes this reachable: one image over two protocols, where the image
  // can only speak for the service as a whole. Writing the debugger down as a second HTTP service
  // would report a container that is running perfectly as DOWN forever.
  const services = translate({ app: { image: "acme/app", container_name: "acme", ports: ["3000:3000", "9229:9229"] } }, "acme");
  equal(services.app.probe, undefined);
  equal(services["app-9229"].probe, "container");
  // The container side, because the published side is whatever the host had free — this repository's
  // own stack publishes redis on 6380, and 6380 says nothing.
  ok(!Compose.speaksHttp("acme/app", 5432));
  ok(Compose.speaksHttp("acme/app", 6380));
  // An engine's own HTTP surface still answers a probe: 15672 is rabbitmq's management UI.
  ok(Compose.speaksHttp("acme/app", 15672));
});

test("where compose runs a service becomes where the description looks for it", () => {
  const services = translate();
  deepEqual(
    { port: services.gitea.port, portVar: services.gitea.portVar, container: services.gitea.container },
    { port: 3020, portVar: "GITEA_PORT", container: "witness-gitea" },
  );
});

test("a container nobody named is still a container", () => {
  // Compose names it `<project>-<service>-<n>`, and the project is in the same document — so leaving
  // `container` unset makes a container probe unanswerable about a service that is running fine.
  const services = translate();
  equal(services.mariadb.container, "witness-mariadb-1");
  equal(services.redis.container, "witness-redis-1");
  // Without a project name there is nothing to derive from, and inventing one would be worse.
  equal(Compose.container(undefined, "redis", undefined), undefined);
});

test("a container name templated by a variable keeps the variable, not the text", () => {
  // `hesta-api${WT:-}` names no container that has ever existed, so the service reports DOWN whatever
  // is running. `suffixVar` is the knob that already expresses this, exactly as `portVar` does.
  deepEqual(Compose.container("hesta-api${WT:-}", "api", "hesta"), { container: "hesta-api", variable: "WT" });
  deepEqual(Compose.container("hesta-web${WT}", "web", "hesta"), { container: "hesta-web", variable: "WT" });
  const read = Compose.translate(
    { api: { image: "acme/api", container_name: "hesta-api${WT:-}" }, web: { image: "acme/web", container_name: "hesta-web${WT:-}" } },
    "hesta",
  );
  equal(read.suffixVar, "WT");
  equal(read.services.api.container, "hesta-api");
});

test("two variables suffixing two services is not one convention, so neither is claimed", () => {
  const read = Compose.translate(
    { api: { image: "a", container_name: "a${WT:-}" }, web: { image: "b", container_name: "b${BRANCH:-}" } },
    "acme",
  );
  equal(read.suffixVar, undefined);
});

test("a postgres image brings its database with it", () => {
  const services = translate();
  deepEqual(services.postgres.database, { user: "gitea", database: "gitea", credential: { containerEnv: "POSTGRES_PASSWORD" } });
  // Only where the image says so. Everything else is a service that happens to have env vars.
  equal(services.gitea.database, undefined);
});

test("so does a mysql or mariadb one", () => {
  // The image was matched against `postgres` alone, so a MariaDB's database name, user and the
  // variable holding its password sat in the compose file being ignored.
  deepEqual(translate().mariadb.database, { user: "witness", database: "witness", credential: { containerEnv: "MARIADB_PASSWORD" } });
  // The MySQL image reads only its own prefix; the MariaDB one reads either, so both are tried.
  deepEqual(Compose.database("mysql:8.4", { MYSQL_USER: "acme", MYSQL_DATABASE: "shop", MYSQL_PASSWORD: "x" }), {
    user: "acme",
    database: "shop",
    credential: { containerEnv: "MYSQL_PASSWORD" },
  });
  equal(Compose.database("redis:7-alpine", { REDIS_PASSWORD: "x" }), undefined);
});

test("a credential becomes a source, never a value", () => {
  const services = translate();
  deepEqual(services.postgres.secrets, { postgresPassword: { containerEnv: "POSTGRES_PASSWORD" } });
  // The compose file holds `${POSTGRES_CREDENTIAL:-x}`. Copying that string in would put a credential
  // in a repository for no reason, when the container that has it can simply be asked.
  ok(!JSON.stringify(services).includes("POSTGRES_CREDENTIAL"));
});

test("both shapes compose accepts for environment read the same", () => {
  deepEqual(Compose.environment(["POSTGRES_USER=gitea", "DEBUG"]), { POSTGRES_USER: "gitea", DEBUG: "" });
  deepEqual(Compose.environment({ POSTGRES_USER: "gitea", DEBUG: null }), { POSTGRES_USER: "gitea", DEBUG: "" });
  deepEqual(Compose.environment(undefined), {});
});

test("no compose file, no answer — and that is not a failure", () => {
  // A machine with no docker, or a project with no compose, is a normal machine and a normal project.
  equal(Compose.read("/nonexistent-checkout", () => "{}"), undefined);
});

test("an answer that is not JSON is not an answer", () => {
  equal(
    Compose.read(process.cwd(), () => "docker: command not found"),
    undefined,
  );
});

test("the generated config says what it left out and where to get it", () => {
  const rendered = Compose.render("acme", Compose.translate(STACK, "witness"));
  match(rendered, /5 services below/);
  // The three things it cannot know, each with the command that answers it.
  match(rendered, /config explore/);
  match(rendered, /config template/);
  match(rendered, /the actions\s+yours to write/);
  // Shaped like the file it is replacing, so it can be edited rather than transcribed.
  ok(rendered.includes('"name": "acme"') && rendered.includes('"services"'));
});

test("two services on one container say so, and one service does not", () => {
  // Written to a file somebody commits, where two entries naming one container reads like a
  // copy-paste — and the reader who deletes the one that looks duplicated deletes the API.
  const two = { demo: { image: "nginx:latest", container_name: "demo", ports: ["3000:3000", "5001:5001"] } };
  const rendered = Compose.render("acme", Compose.translate(two, "demo"));
  match(rendered, /name the SAME container/);
  // Every container it happened to, not one example: a reader looking at the entry that is not named
  // has no way to tell the paragraph is about theirs too.
  match(rendered, /^\/\/ {3}demo: demo, demo-5001$/m);
  // Said only when it fired: a stack where every service has its own container needs no paragraph.
  equal(/name the SAME container/.test(Compose.render("acme", Compose.translate(STACK, "witness"))), false);
});

test("the runner that actually ships asks docker for an UNinterpolated config", () => {
  // The only line in this file that runs in production, and the only one no test reached: every other
  // test hands `read` its own runner. Dropping `--no-interpolate` leaves the whole suite green and
  // every generated config without its `portVar` — `${GITEA_PORT:-3020}` arrives as `3020` and the
  // VARIABLE NAME, which is the knob, is gone. Nothing notices until a second checkout runs its own
  // ports. So this asserts the argv, not the answer.
  const calls: [string, readonly string[]][] = [];
  const exec = ((file: string, args: string[]) => {
    calls.push([file, args]);
    return "{}";
  }) as typeof execFileSync;

  Compose.docker(process.cwd(), exec);

  deepEqual(calls, [["docker", ["compose", "config", "--no-interpolate", "--format", "json"]]]);
});

test("a docker that is not there is not an answer", () => {
  // Nothing rather than a throw: a machine with no docker is a normal machine.
  const exec = (() => {
    throw new Error("docker: command not found");
  }) as typeof execFileSync;
  equal(Compose.docker(process.cwd(), exec), undefined);
});

test("the database the app says it needs is the one db sql means", () => {
  // `db sql` runs against the FIRST service to declare a database, and `docker compose config` hands
  // them back alphabetically — so on this stack the default was **mariadb**, and a bare `db sql` ran
  // `psql` inside MariaDB. Nothing in the description said which one the app used; the letter `m` did.
  const { services } = Compose.translate(STACK, "witness");
  const withDatabase = Object.entries(services)
    .filter(([, service]) => service.database)
    .map(([name]) => name);
  deepEqual(withDatabase, ["postgres", "mariadb"]);
});

test("where the file says nothing, the order is left exactly as compose gave it", () => {
  // Most compose files declare no `depends_on` at all. A guess in a generated file is worse than an
  // order somebody has to look at, so nothing moves and the author's own ordering decides.
  const silent = Object.fromEntries(Object.entries(STACK).map(([name, service]) => [name, { ...service, depends_on: undefined }]));
  deepEqual(Object.keys(Compose.translate(silent, "witness").services), Object.keys(STACK));
});

test("a stack with two databases says which one db sql means", () => {
  // Only when it fired: the order is what decides, and a reader who tidied it back to alphabetical
  // would repoint `db sql` without touching a field.
  match(Compose.render("acme", Compose.translate(STACK, "witness")), /db sql` runs against the FIRST one listed — postgres/);
  // One database needs no paragraph about which one.
  const one = { postgres: STACK.postgres };
  equal(/runs against the FIRST one listed/.test(Compose.render("acme", Compose.translate(one, "witness"))), false);
});
