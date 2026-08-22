import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import { Registry } from "./registry.ts";

test("a provider is registered and fetched by name", () => {
  const registry = new Registry<string>("client").register("rest", "R").register("graphql", "G");
  equal(registry.get("rest"), "R");
  deepEqual(registry.names, ["rest", "graphql"]);
  ok(registry.has("graphql"));
  ok(!registry.has("soap"));
});

test("registering returns the registry, so registrations chain", () => {
  const registry = new Registry<number>("thing");
  equal(registry.register("a", 1), registry);
});

test("a name that is not registered says what is", () => {
  // The alternative is a stack trace about `undefined` two frames later, which says nothing about the
  // config line that caused it.
  const registry = new Registry<string>("secret").register("env", "E");
  throws(() => registry.get("vault"), /no secret provider "vault" — registered: env/);
  throws(() => new Registry<string>("video").get("ffmpeg"), /registered: none/);
});

test("registering the same name again replaces it", () => {
  const registry = new Registry<string>("auth").register("apiKey", "first").register("apiKey", "second");
  equal(registry.get("apiKey"), "second");
  deepEqual(registry.names, ["apiKey"]);
});
