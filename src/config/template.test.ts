import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";

import { Registry } from "../providers/registry.ts";
import { Compose } from "./compose.ts";
import { Template } from "./template.ts";
import { TypeSource } from "./types.ts";
import { withoutComments } from "./load.ts";

const render = (source: string, opts: { providers?: Map<string, string[]>; maxDepth?: number } = {}): string =>
  new Template({ types: new TypeSource().read(source), ...opts }).render("Root");

const parse = (jsonc: string): Record<string, unknown> => JSON.parse(withoutComments(jsonc)) as Record<string, unknown>;

test("a field is shown under its own documentation", () => {
  const out = render(`export type Root = {
    /** What the command line is called. */
    name: string;
  };`);
  match(out, /\/\/ required\. What the command line is called\.\n\s+"name": "…"/);
});

test("required is said, optional is not", () => {
  const out = render("export type Root = { needed: string; optional?: string };");
  match(out, /\/\/ required\.\n\s+"needed"/);
  ok(!/\/\/ required\.\n\s+"optional"/.test(out), "an optional field should carry no marker");
});

test("keys you choose are shown as such", () => {
  const out = render("export type Root = { services: Record<string, { port?: number }> };");
  match(out, /"services": \{\n\s+"<name>": \{/);
  deepEqual(parse(out), { services: { "<name>": { port: 0 } } });
});

test("primitives get a value of the right type, so the template parses", () => {
  const out = render("export type Root = { s: string; n: number; b: boolean; u: unknown; list: string[] };");
  deepEqual(parse(out), { s: "…", n: 0, b: false, u: {}, list: ["…"] });
});

test("a union of literals shows one and names the rest", () => {
  const out = render(`export type Root = { kind?: "in-house" | "third-party" };`);
  match(out, /"kind": "in-house",?\s+\/\/ one of: in-house \| third-party/);
});

test("a union with a shape in it shows the shape and names the alternatives", () => {
  const out = render(`export type Root = { probe?: "http" | "container" | { path?: string } };`);
  match(out, /\/\/ or: "http" \| "container"\n\s+"probe": \{/);
  match(out, /"path": "…"/);
});

test("a type used twice is spelled out once and pointed at after that", () => {
  const out = render(`export type Root = { first?: Locator; second?: Locator };
  export type Locator = { css?: string };`);
  equal(out.match(/"css"/g)?.length, 1);
  match(out, /"second": \{\}\s+\/\/ a Locator — spelled out under "first"/);
});

test("a type that contains itself does not recur forever", () => {
  const out = render(`export type Root = { at?: Locator };
  export type Locator = { css?: string; within?: Locator };`);
  match(out, /"within": \{\},?\s+\/\/ a Locator again — nest as deep as you need/);
  deepEqual(parse(out), { at: { css: "…", within: {} } });
});

test("a provider field offers what is actually registered", () => {
  const providers = new Map([["client", ["rest", "graphql"]], ["video", ["ffmpeg"]]]);
  const out = render("export type Root = { client?: ClientConfig };\nexport type ClientConfig = { provider?: string };", { providers });
  match(out, /"provider": "…",?\s+\/\/ one of: rest, graphql/);
  match(out, /\/\/ {3}client\s+rest, graphql/);
  match(out, /\/\/ {3}video\s+ffmpeg/);
});

test("nesting past the limit stops rather than running away", () => {
  const chain = "export type Root = { a?: A };\nexport type A = { b?: B };\nexport type B = { c?: C };\nexport type C = { d?: string };";
  match(render(chain, { maxDepth: 2 }), /nested deeper than this template goes/);
  // …and with room, the same chain is spelled out to the end.
  ok(render(chain).includes('"d": "…"'));
});

test("what a type says it cannot model is printed rather than hidden", () => {
  const out = render("export type Root = { hook?: (page: Page) => void };");
  match(out, /"hook": \{\},?\s+\/\/ \(page: Page\) => void/);
});

test("witness's own template covers every field of SystemConfig, and parses", () => {
  // The guarantee the whole thing exists for: what the config type declares is what the template shows.
  const types = TypeSource.fromDirectory(new URL("..", import.meta.url).pathname);
  const schema = types.declaration("SystemConfig");
  ok(schema.kind === "object");

  const rendered = Template.forWitness().render();
  const parsed = parse(rendered);
  deepEqual(Object.keys(parsed), schema.fields.map(f => f.name));
});

test("witness's own template covers every field of a service, the ones `init` writes included", () => {
  // Counted against two things that are NOT the template: the type that declares where a service runs,
  // and the config `init` really generates from a compose file. Counting a service's keys against
  // `ServiceConfig` would have proved nothing — the reader dropped `ServiceSpec` from the declaration
  // and from the template alike, so the two agreed perfectly on a shape neither of them had.
  const types = TypeSource.fromDirectory(new URL("..", import.meta.url).pathname);
  const spec = types.declaration("ServiceSpec");
  ok(spec.kind === "object");

  const services = parse(Template.forWitness().render()).services as Record<string, Record<string, unknown>>;
  const service = Object.keys(services["<name>"]);
  for (const field of spec.fields) ok(service.includes(field.name), `a service's "${field.name}" is missing from the template`);

  // And the four that sent someone here in the first place: `init` writes them into the file directly
  // above the comment pointing at `config template` for everything it left out.
  const written = Compose.translate({ web: { build: { context: "." }, container_name: "acme-web${WT:-}", ports: ["${WEB_PORT:-3000}:3000"] } }, "acme");
  deepEqual(Object.keys(written.services.web), ["kind", "port", "portVar", "container"]);
  for (const field of Object.keys(written.services.web)) {
    ok(service.includes(field), `\`init\` writes "${field}" into a service, and the template does not have it`);
  }
});

test("witness's own template names every registered provider", () => {
  const rendered = Template.forWitness().render();
  for (const [kind, names] of Template.providers()) {
    for (const name of names) ok(rendered.includes(name), `${kind} provider "${name}" is missing from the template`);
  }
});

test("provider kinds are found in the module rather than listed", () => {
  const found = Template.providers({ some: new Registry("thing").register("one", {}), notARegistry: {} });
  deepEqual([...found], [["thing", ["one"]]]);
});
