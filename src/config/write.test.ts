import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { Author } from "./write.ts";
import { Explore } from "./explore.ts";
import { Template } from "./template.ts";
import { TypeSource } from "./types.ts";
import { withoutComments } from "./load.ts";

/** The kind of file this writes to: a description with the prose that documents it in it. */
const described = `// The acme stack, described.
//
// Two services, and the reason each one is here.
{
  "name": "acme",
  "services": {
    // The app a person uses.
    "web": {
      "port": 3000,
      "container": "acme-web",
      "app": {
        "routes": { "home": "/", "login": "/login" }
      },
      "actions": {
        // The first thing anybody does.
        "signIn": {
          "summary": "sign in as somebody",
          "steps": [{ "goto": { "route": "login" } }, { "click": { "role": "button", "name": "Sign in" } }]
        }
      }
    },
    // What it stores things in.
    "db": {
      "port": 5432,
      "container": "acme-db"
    }
  }
}
`;

/** A description on disk, and the path to it. */
const describing = (source = described): string => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "witness-write-")), "config.jsonc");
  writeFileSync(file, source);
  return file;
};

const read = (file: string): string => readFileSync(file, "utf8");
const value = (file: string): any => JSON.parse(withoutComments(read(file)));

/** A step list somebody would actually hand this. */
const steps = '{ "summary": "read a paste", "steps": [{ "goto": { "route": "home" } }, { "expect": { "on": { "role": "heading", "name": "Acme" } } }] }';

test("an action is validated, placed under its service, and written", () => {
  const file = describing();
  const change = Author.addAction(file, "web.readAPaste", steps);
  equal(change.wrote, true);
  deepEqual(change.changed, ["services.web.actions.readAPaste"]);
  match(change.summary, /^wrote services\.web\.actions\.readAPaste to /);
  equal(value(file).services.web.actions.readAPaste.summary, "read a paste");
  // Beside the one that was already there, not instead of it.
  ok(value(file).services.web.actions.signIn);
});

test("…and a name with no dot in it goes to the top level, which is what the top level is for", () => {
  const file = describing();
  Author.addAction(file, "theWholeThing", steps);
  equal(value(file).actions.theWholeThing.summary, "read a paste");
  equal(value(file).services.web.actions.theWholeThing, undefined);
});

test("…and the step list on its own is an action too", () => {
  // Both are things a caller has in front of it: `action show` prints the whole action, and a fragment
  // somebody is writing is usually just the steps.
  const file = describing();
  Author.addAction(file, "web.bare", '[{ "reload": true }]');
  deepEqual(value(file).services.web.actions.bare, { steps: [{ reload: true }] });
});

test("adding the same action twice is one action", () => {
  const file = describing();
  equal(Author.addAction(file, "web.readAPaste", steps).wrote, true);
  const written = read(file);
  const again = Author.addAction(file, "web.readAPaste", steps);
  equal(again.wrote, false);
  deepEqual(again.changed, []);
  match(again.summary, /is already what .* says — nothing written/);
  equal(read(file), written, "the second one did not even rewrite the same bytes");
});

test("every comment in the description survives a write", () => {
  // The hard part of this whole surface. The comments in that file are its documentation, so a writer
  // that reflows them away turns a one-action change into an unreviewable diff — worse than the
  // string-splicing it exists to replace.
  const file = describing();
  Author.addAction(file, "web.readAPaste", steps);
  for (const prose of ["// The acme stack, described.", "// Two services, and the reason each one is here.", "// The app a person uses.", "// The first thing anybody does.", "// What it stores things in."]) {
    ok(read(file).includes(prose), prose);
  }
});

test("…and so does every line the change did not have to touch", () => {
  const file = describing();
  Author.set(file, "services.db.port", "5433");
  const was = described.split("\n");
  const now = read(file).split("\n");
  equal(now.length, was.length);
  deepEqual(now.filter((line, at) => line !== was[at]), ['      "port": 5433,']);
});

test("add then remove leaves the file it started as, byte for byte", () => {
  const file = describing();
  Author.addAction(file, "web.readAPaste", steps);
  const removed = Author.removeAction(file, "web.readAPaste");
  equal(removed.wrote, true);
  equal(read(file), described);
});

test("removing the last action in a block takes the block, and says so", () => {
  const file = describing();
  const removed = Author.removeAction(file, "web.signIn");
  match(removed.summary, /and services\.web\.actions with it, which held nothing else/);
  equal(value(file).services.web.actions, undefined);
  // The note that documented it went with it; the one about the service did not.
  ok(!read(file).includes("The first thing anybody does"));
  ok(read(file).includes("// The app a person uses."));
});

test("removing something that is not declared is not an error", () => {
  const file = describing();
  const removed = Author.removeAction(file, "web.nope");
  equal(removed.wrote, false);
  match(removed.summary, /"web\.nope" is not in .* — nothing removed/);
  equal(read(file), described);
});

test("a bare name being removed is answered for, and never guessed at", () => {
  // `action run` takes a bare name whenever exactly one service declares it and refuses to guess when
  // two do. Removing is where guessing is least forgivable, so it answers the same way.
  const two = described.replace('"container": "acme-db"', '"container": "acme-db",\n      "actions": { "signIn": { "steps": [{ "reload": true }] } }');
  const file = describing(two);
  throws(() => Author.removeAction(file, "signIn"), /declared by 2 services — name the one you mean: web\.signIn, db\.signIn/);
  equal(read(file), two, "and it left the file alone while refusing");
});

test("a step verb that does not exist is refused, before it runs green and moves nothing", () => {
  // The failure this check exists for: the runner dispatches one `if` per verb, so a key it does not
  // recognise is not an error — it is nothing at all. `clik` photographs the screen it did not touch
  // and reports a passing action.
  const file = describing();
  throws(
    () => Author.addAction(file, "web.typo", '{ "steps": [{ "clik": { "role": "button" } }] }'),
    /step 1 of "web\.typo" says "clik", which no step verb is called.*would have run green and moved nothing.*Verbs: note, goto, click/s,
  );
  equal(read(file), described, "and the file is byte-identical");
});

test("the verbs it checks against are the ones the engine dispatches on, read out of the type", () => {
  // A hand-kept list would be wrong the week after somebody added a verb, and the failure would be
  // this command refusing a step the runner supports — so the list is asked for rather than written,
  // the same way the template and the skill are. Pinned against the declaration itself: a test that
  // only checked "some list came back" would pass against any list at all.
  const step = TypeSource.fromDirectory(Template.sourceDir()).declaration("StepConfig");
  ok(step.kind === "object");
  const file = describing();
  const said = String(throwsWith(() => Author.addAction(file, "web.typo", '{ "steps": [{ "clik": {} }] }')));
  equal(said.slice(said.indexOf("Verbs: ") + "Verbs: ".length), step.fields.map(field => field.name).join(", "));

  // And every one of them is accepted, so the check cannot pass by refusing everything.
  for (const verb of step.fields.map(field => field.name)) {
    Author.addAction(file, `web.uses_${verb}`, JSON.stringify({ steps: [{ [verb]: {} }] }));
  }
  equal(Object.keys(value(file).services.web.actions).length, step.fields.length + 1);
});

/** The message a call refused with, for a test that is about the message rather than the refusal. */
const throwsWith = (run: () => unknown): string => {
  try {
    run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("it did not refuse");
};

test("an action with no steps is refused, because one would pass and prove nothing", () => {
  const file = describing();
  throws(() => Author.addAction(file, "web.empty", '{ "summary": "x" }'), /needs a non-empty "steps" array/);
  throws(() => Author.addAction(file, "web.empty", '{ "steps": [] }'), /needs a non-empty "steps" array/);
  throws(() => Author.addAction(file, "web.empty", '{ "steps": [{}] }'), /step 1 of "web\.empty" is empty, so it names no verb/);
  equal(read(file), described);
});

test("a field an action does not have is refused with the ones it does", () => {
  const file = describing();
  throws(() => Author.addAction(file, "web.x", '{ "sumary": "x", "steps": [{ "reload": true }] }'), /declares "sumary".*Fields: summary, records/s);
  equal(read(file), described);
});

test("a service that is not declared is refused with the ones that are", () => {
  const file = describing();
  throws(() => Author.addAction(file, "nowhere.x", '[{ "reload": true }]'), /no service "nowhere" — declared: web, db/);
  equal(read(file), described);
});

test("a fragment that is not a fragment says so, and points at what prints one", () => {
  const file = describing();
  throws(() => Author.merge(file, "not json at all"), /that is not a JSONC fragment.*config explore <service>` prints one/s);
  throws(() => Author.merge(file, "[1, 2]"), /a fragment is an object of config fields, and this is an array/);
  throws(() => Author.merge(file, '"web"'), /and this is a string/);
  equal(read(file), described);
});

test("the generated template is refused rather than written, placeholders and all", () => {
  // `config template | config merge -` is a thing somebody will type. Every value in that file is the
  // `"…"` placeholder, and merging it would replace a working description with an unloadable one.
  const file = describing();
  throws(() => Author.merge(file, Template.forWitness().render()), /that would write "…" — the placeholder `config template` puts where a value goes/);
  equal(read(file), described);
});

test("…but a description that is still the template can be filled in one field at a time", () => {
  // The other side of the same rule. A fresh `init` writes a file that does NOT load — every field is
  // `"…"` — and a writer that refused to touch it would be refusing at the one moment it is useful.
  const file = describing(Template.forWitness().render());
  const change = Author.set(file, "name", "acme");
  equal(change.wrote, true);
  equal(value(file).name, "acme");
});

test("a change that would leave the description unreadable is refused", () => {
  const file = describing();
  throws(() => Author.set(file, "services.web", "null"), /that would leave .* unreadable/);
  equal(read(file), described);
});

test("a description that is not JSONC is refused rather than spliced at a guess", () => {
  // An offset into text nobody can parse is fiction. This is the one repair that is not this
  // surface's job, and saying so beats corrupting the file further.
  const file = describing('{ "name": "acme", "services": }');
  throws(() => Author.merge(file, '{ "name": "other" }'), /is not valid JSONC.*Fix it by hand/s);
});

test("config set writes the type a value is, not the text it was typed as", () => {
  // `"port": "3000"` is a description that lies about its own type, and where that is found out is a
  // URL built from it.
  const file = describing();
  Author.set(file, "services.web.port", "3001");
  equal(value(file).services.web.port, 3001);
  Author.set(file, "services.web.app.routes.about", "/about");
  equal(value(file).services.web.app.routes.about, "/about");
  Author.set(file, "root", '[".git"]');
  deepEqual(value(file).root, [".git"]);
});

test("config set refuses a block and points at the verb that takes one", () => {
  // "Set this field to this object" has two readings — replace it, or merge into it — and a verb
  // whose meaning depends on what is already in the file is what this surface exists to stop being.
  const file = describing();
  throws(() => Author.set(file, "services.web", '{ "port": 1 }'), /is a block, and `config set` writes one field/);
  throws(() => Author.set(file, "", "x"), /is not a field/);
  throws(() => Author.set(file, "services..port", "1"), /is not a field/);
  equal(read(file), described);
});

test("a field that did not exist is created along with the blocks above it", () => {
  const file = describing();
  const change = Author.set(file, "services.db.app.routes.home", "/");
  deepEqual(change.changed, ["services.db.app.routes.home"], "the field asked for, not where the splice landed");
  deepEqual(value(file).services.db.app, { routes: { home: "/" } });
});

/**
 * The loop this whole half exists to close.
 *
 * `config explore` printed exactly the shape a description wants and its own header told the reader to
 * merge it by hand — the tool generating a fragment it would not accept back. Rendered by the real
 * renderer, comment header and all, because the header is the half a JSON parser chokes on.
 */
const crawled = (): string =>
  Explore.render(
    {
      routes: { home: "/", guide: "/guide" },
      locators: { save: { role: "button", name: "Save" }, options: { role: "heading", name: "Options" } },
      forms: { form: { contentInput: "Type something here." } },
      unfillable: ["/ — Expiration ?, Privacy ?"],
      operations: { pastes: { method: "GET", path: "/api/pastes" } },
      visited: ["/", "/guide"],
      skipped: ["/login/oauth — begins a handoff to somebody else's identity provider"],
      empty: [],
      behindSignIn: false,
    },
    "web",
  );

test("the fragment explore prints is accepted by merge, comment header and all", () => {
  const file = describing();
  const change = Author.merge(file, crawled());
  equal(change.wrote, true);
  deepEqual(change.changed, ["services.web.app.routes.guide", "services.web.app.locators", "services.web.app.forms", "services.web.api"]);
  equal(value(file).services.web.app.routes.guide, "/guide");
  deepEqual(value(file).services.web.app.locators.save, { role: "button", name: "Save" });
  deepEqual(value(file).services.web.api.operations.pastes, { method: "GET", path: "/api/pastes" });
  // The routes it already declared are still declared, and the action beside them is untouched.
  equal(value(file).services.web.app.routes.home, "/");
  ok(value(file).services.web.actions.signIn);
});

test("…and merging it a second time writes nothing", () => {
  // Two runs against an unchanged app are one edit. Without this a regenerated fragment is churn in
  // the diff, which is how a generated block stops being read.
  const file = describing();
  Author.merge(file, crawled());
  const written = read(file);
  const again = Author.merge(file, crawled());
  equal(again.wrote, false);
  match(again.summary, /the description is already what .* says — nothing written/);
  equal(read(file), written);
});

test("…and the comments in the description survive it", () => {
  const file = describing();
  Author.merge(file, crawled());
  for (const prose of ["// The acme stack, described.", "// The app a person uses.", "// The first thing anybody does.", "// What it stores things in."]) {
    ok(read(file).includes(prose), prose);
  }
  // The fragment's own header does not travel: it is a report about a crawl, and there is nowhere in
  // the file it would honestly belong.
  ok(!read(file).includes("Walked 2 pages"));
});
