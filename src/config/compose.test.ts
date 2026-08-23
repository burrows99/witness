import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";

import { Compose } from "./compose.ts";

/** What `docker compose config --no-interpolate --format json` gives back for this repo's own stack. */
const STACK = {
  gitea: {
    image: "gitea/gitea:1.21.11",
    container_name: "witness-gitea",
    ports: ["${GITEA_PORT:-3020}:3000"],
    environment: { GITEA__database__USER: "gitea", GITEA__database__PASSWD: "${POSTGRES_CREDENTIAL:-x}" },
  },
  postgres: {
    image: "postgres:17",
    container_name: "witness-postgres",
    ports: ["${POSTGRES_PORT:-5441}:5432"],
    environment: { POSTGRES_DB: "gitea", POSTGRES_USER: "gitea", POSTGRES_PASSWORD: "${POSTGRES_CREDENTIAL:-x}" },
  },
  worker: { build: { context: "." }, container_name: "witness-worker" },
};

test("a port mapping keeps the variable that sets it", () => {
  // `--no-interpolate` exists for this line. With the value substituted the variable name is gone,
  // and `portVar` is the whole reason a second checkout can run its own ports without a wrapper.
  deepEqual(Compose.published(["${GITEA_PORT:-3020}:3000"]), { variable: "GITEA_PORT", port: 3020 });
  deepEqual(Compose.published(["8025:8025"]), { port: 8025 });
  deepEqual(Compose.published(["127.0.0.1:5432:5432"]), { port: 5432 });
  equal(Compose.published(undefined), undefined);
});

test("a service built here is ours; one pulled by tag is not", () => {
  const services = Compose.translate(STACK);
  equal(services.worker.kind, "in-house");
  equal(services.postgres.kind, "third-party");
});

test("a service that publishes no port can only be asked of docker", () => {
  const services = Compose.translate(STACK);
  equal(services.worker.probe, "container");
  // One that does publish a port answers HTTP, which is already the default.
  equal(services.gitea.probe, undefined);
});

test("where compose runs a service becomes where the description looks for it", () => {
  const services = Compose.translate(STACK);
  deepEqual(
    { port: services.gitea.port, portVar: services.gitea.portVar, container: services.gitea.container },
    { port: 3020, portVar: "GITEA_PORT", container: "witness-gitea" },
  );
});

test("a postgres image brings its database with it", () => {
  const services = Compose.translate(STACK);
  deepEqual(services.postgres.database, { user: "gitea", database: "gitea", credential: { containerEnv: "POSTGRES_PASSWORD" } });
  // Only where the image says so. Everything else is a service that happens to have env vars.
  equal(services.gitea.database, undefined);
});

test("a credential becomes a source, never a value", () => {
  const services = Compose.translate(STACK);
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
  const rendered = Compose.render("acme", Compose.translate(STACK));
  match(rendered, /3 services below/);
  // The three things it cannot know, each with the command that answers it.
  match(rendered, /config explore/);
  match(rendered, /config template/);
  match(rendered, /the actions\s+yours to write/);
  // Shaped like the file it is replacing, so it can be edited rather than transcribed.
  ok(rendered.includes('"name": "acme"') && rendered.includes('"services"'));
});
