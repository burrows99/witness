import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import { Jsonc, isBlock, merged } from "./edit.ts";
import { withoutComments } from "./load.ts";

/** A description with prose in every place a description keeps prose. */
const described = `// The acme stack, described.
//
// One service, and the reason it is the only one.
{
  "name": "acme",
  "services": {
    // The app. A UI and the API underneath it.
    "web": {
      "port": 3000, // the dev server, not the built one
      "container": "acme-web",
      "app": {
        "routes": { "home": "/", "login": "/login" }
      },
      "actions": {
        /* The first thing anybody does. */
        "signIn": {
          "summary": "sign in as somebody",
          "steps": [
            { "goto": { "route": "login" } },
            { "click": { "role": "button", "name": "Sign in" } }
          ]
        }
      }
    }
  }
}
`;

const value = (source: string): unknown => JSON.parse(withoutComments(source));

test("a merged field leaves every comment in the file where it was", () => {
  // The whole risk of writing to this file. Its comments ARE the documentation — `init` writes a
  // header, `explore` writes notes, and whoever authored it wrote the rest — so a writer that
  // reformats them away turns a one-field change into a diff nobody can review, which is worse than
  // the string-splicing it replaces.
  const { source } = Jsonc.parse(described).merge({ services: { web: { port: 3001 } } });
  for (const prose of [
    "// The acme stack, described.",
    "// One service, and the reason it is the only one.",
    "// The app. A UI and the API underneath it.",
    "// the dev server, not the built one",
    "/* The first thing anybody does. */",
  ]) {
    ok(source.includes(prose), `${prose} survived`);
  }
  equal((value(source) as any).services.web.port, 3001);
});

test("…and every line it did not have to touch, byte for byte", () => {
  const { source } = Jsonc.parse(described).merge({ services: { web: { port: 3001 } } });
  const was = described.split("\n");
  const now = source.split("\n");
  equal(now.length, was.length, "no line was added or removed for a change to one value");
  const moved = now.filter((line, index) => line !== was[index]);
  deepEqual(moved, ['      "port": 3001, // the dev server, not the built one']);
});

test("a note written after a member stays with that member", () => {
  // The comma has to go against the value and the new line has to go after the note. Putting the
  // comma after it puts a comma inside a comment; putting the new member before it slides somebody
  // else's sentence onto a field it was never about.
  const { source } = Jsonc.parse(described).merge({ services: { web: { probe: "container" } } });
  ok(source.includes('"port": 3000, // the dev server, not the built one'), "the note did not move");
  ok(source.includes('"probe": "container"'));
  equal((value(source) as any).services.web.probe, "container");
});

test("a field that already says this is not written at all", () => {
  // Idempotence, and it is the same rule as comment preservation one layer down: rewriting an
  // identical value would splice out whatever is written inside it, for no change to the config.
  const { source, changed } = Jsonc.parse(described).merge({
    services: { web: { port: 3000, app: { routes: { home: "/" } } } },
  });
  equal(source, described);
  deepEqual(changed, []);
});

test("a new member is written in the indentation the file is already using", () => {
  const tabbed = '{\n\t"name": "acme",\n\t"services": {}\n}\n';
  const { source } = Jsonc.parse(tabbed).merge({ services: { web: { port: 3000 } } });
  ok(source.includes('\t\t"web": { "port": 3000 }'), source);
});

test("a short value goes on one line, the way a step list is written", () => {
  // `JSON.stringify(v, null, 2)` gives every key a line of its own, and no config anywhere is
  // written that way — a two-step action would arrive as fourteen lines of diff instead of four.
  const { source } = Jsonc.parse(described).merge({
    services: { web: { actions: { open: { steps: [{ goto: { route: "home" } }, { reload: true }] } } } },
  });
  ok(source.includes('{ "goto": { "route": "home" } },'), source);
  ok(source.includes("{ \"reload\": true }"), source);
});

test("…and one too long for a line is broken across them", () => {
  const long = { steps: [{ note: "x".repeat(200) }] };
  const { source } = Jsonc.parse(described).merge({ services: { web: { actions: { wordy: long } } } });
  ok(/"wordy": \{\n/.test(source), source);
});

test("an array is replaced whole rather than merged into", () => {
  // There is no honest elementwise merge of two step lists: nothing says whether the step at index 3
  // is the same step, so a writer that tried would silently interleave one flow into another.
  const { source } = Jsonc.parse(described).merge({
    services: { web: { actions: { signIn: { steps: [{ reload: true }] } } } },
  });
  deepEqual((value(source) as any).services.web.actions.signIn.steps, [{ reload: true }]);
});

test("a whole block arrives under the key it was aimed at", () => {
  const { source, changed } = Jsonc.parse(described).merge({
    services: { api: { port: 4000, app: { routes: { health: "/health" } } } },
  });
  deepEqual(changed, ["services.api"]);
  deepEqual((value(source) as any).services.api, { port: 4000, app: { routes: { health: "/health" } } });
  // And the service beside it is untouched, comments and all.
  ok(source.includes("// The app. A UI and the API underneath it."));
});

test("two new members of one object are one insertion, in the order they were given", () => {
  // Two splices at the same offset are applied in whichever order they were sorted into, which is
  // how a writer produces `{ "b": 2, "a": 1 }` out of `{ a, b }` — or two commas, or none.
  const { source } = Jsonc.parse(described).merge({ evidence: { dir: "out" }, video: { provider: "ffmpeg" } });
  deepEqual(Object.keys(value(source) as object), ["name", "services", "evidence", "video"]);
});

test("an empty object grows its first member without losing its braces", () => {
  const empty = '{\n  "name": "acme",\n  "services": {}\n}\n';
  const { source } = Jsonc.parse(empty).merge({ services: { web: { port: 3000 } } });
  deepEqual(value(source), { name: "acme", services: { web: { port: 3000 } } });
  ok(source.includes('"services": {\n    "web": { "port": 3000 }\n  }'), source);
});

test("removing a member takes the note written above it", () => {
  // A comment directly above a member documents that member. Left behind it becomes prose about
  // something that is not there, which is worse than no prose at all.
  const { source, cut } = Jsonc.parse(described).remove(["services", "web", "actions", "signIn"]);
  deepEqual(cut, ["services", "web", "actions"], "the block that held it went too, holding nothing else");
  ok(!source.includes("The first thing anybody does"), source);
  ok(!source.includes("signIn"), source);
  // And the comment about the section it was NOT in stays.
  ok(source.includes("// The app. A UI and the API underneath it."));
  deepEqual(value(source), {
    name: "acme",
    services: { web: { port: 3000, container: "acme-web", app: { routes: { home: "/", login: "/login" } } } },
  });
});

test("removing the last member takes the comma that was holding it on", () => {
  const { source } = Jsonc.parse(described).remove(["services", "web", "app"]);
  deepEqual(value(source), {
    name: "acme",
    services: {
      web: {
        port: 3000,
        container: "acme-web",
        actions: { signIn: { summary: "sign in as somebody", steps: [{ goto: { route: "login" } }, { click: { role: "button", name: "Sign in" } }] } },
      },
    },
  });
});

test("removing something that is not there is not an error", () => {
  const { source, cut } = Jsonc.parse(described).remove(["services", "web", "actions", "nope"]);
  equal(source, described);
  equal(cut, undefined);
});

test("adding then removing is the file it started as, byte for byte", () => {
  // The strongest thing this can be asked. Anything that reflows, reindents or drops a blank line
  // fails it, and it is the property a reviewer is really relying on.
  const added = Jsonc.parse(described).merge({ services: { web: { actions: { open: { steps: [{ reload: true }] } } } } });
  const { source } = Jsonc.parse(added.source).remove(["services", "web", "actions", "open"]);
  equal(source, described);
});

test("a document that is not JSONC says where it stopped rather than guessing", () => {
  // An offset into text nobody can parse is fiction, and splicing at one would corrupt a file this
  // whole surface exists to keep loadable.
  throws(() => Jsonc.parse('{ "a": 1'), /never closed/);
  throws(() => Jsonc.parse('{ a: 1 }'), /must be a quoted string/);
  throws(() => Jsonc.parse('{ "a" 1 }'), /not followed by a colon/);
  throws(() => Jsonc.parse('{ "a": 1 } trailing'), /past the end/);
});

test("a comment-shaped thing inside a string is not a comment", () => {
  // Half the URLs in a config contain `//`, and the parser walks the text rather than a token stream.
  const source = '{\n  "url": "https://acme.test/v1",\n  "note": "/* not a comment */"\n}\n';
  const { source: written } = Jsonc.parse(source).merge({ name: "acme" });
  deepEqual(value(written), { url: "https://acme.test/v1", note: "/* not a comment */", name: "acme" });
});

test("the value merge and the text merge agree, which is what makes the text merge safe", () => {
  // `merged` is the same rule with no offsets in it. The writer's whole safety net is comparing what
  // the spliced FILE says against what this says it should — two implementations of one rule, only
  // one of which can land in the wrong place.
  const fragment = { services: { web: { port: 3001, app: { routes: { about: "/about" } } } }, name: "other" };
  const { source } = Jsonc.parse(described).merge(fragment);
  deepEqual(value(source), merged(value(described), fragment));
});

test("isBlock separates the thing a merge goes INTO from every value it writes over", () => {
  ok(isBlock({}));
  ok(!isBlock([]));
  ok(!isBlock(null));
  ok(!isBlock("{}"));
});

test("an object somebody wrote on one line grows on that line", () => {
  // `"routes": { "home": "/" }` is how a description is written. A fourth route arriving as three
  // lines of its own reformats a block nobody asked to have reformatted, which is the same failure as
  // dropping a comment: the diff stops being about the change.
  const { source } = Jsonc.parse(described).merge({ services: { web: { app: { routes: { about: "/about" } } } } });
  ok(source.includes('"routes": { "home": "/", "login": "/login", "about": "/about" }'), source);
});

test("…including a whole file written on one, which is what a minified config.json is", () => {
  const minified = '{"name":"acme","services":{"web":{"port":3000}}}';
  const { source } = Jsonc.parse(minified).merge({ services: { web: { container: "acme-web" } } });
  equal(source, '{"name":"acme","services":{"web":{"port":3000, "container": "acme-web"}}}');
});

test("removing the last member of a one-line object cuts the comma once", () => {
  // It cut it twice: the removal span has no line start to stop at, so it swallowed the comma, and
  // then the rule for a dangling comma cut it again. What that produces is not an error but a file
  // that no longer parses — which is why overlapping edits are refused rather than applied.
  const minified = '{"name":"acme","services":{"web":{"port":3000,"actions":{"a":{"steps":[{"reload":true}]}}}}}';
  const { source } = Jsonc.parse(minified).remove(["services", "web", "actions", "a"]);
  equal(source, '{"name":"acme","services":{"web":{"port":3000}}}');
});
