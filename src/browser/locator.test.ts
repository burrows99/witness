import { deepEqual, equal, match, throws } from "node:assert/strict";
import { test } from "node:test";

import { describe, locate, type LocatorSpec } from "./locator.ts";

/** A page that records how it was asked for something rather than looking for it. */
const page = () => {
  // A found thing can itself be searched, which is what `within` does.
  const found = (what: string): Record<string, unknown> => ({
    what,
    filter: (opts: { hasText: string }) => found(`${what} hasText=${opts.hasText}`),
    nth: (n: number) => found(`${what} nth=${n}`),
    or: (other: { what: string }) => found(`${what} or ${other.what}`),
    locator: (selector: string) => found(`${what} >> css=${selector}`),
    getByRole: (role: string) => found(`${what} >> role=${role}`),
    getByPlaceholder: (value: string) => found(`${what} >> placeholder=${value}`),
    getByTestId: (value: string) => found(`${what} >> testId=${value}`),
    getByLabel: (value: string) => found(`${what} >> label=${value}`),
    getByText: (value: string) => found(`${what} >> text=${value}`),
  });
  const surface = {
    getByRole: (role: string, opts: { name?: unknown; exact?: boolean }) =>
      found(`role=${role}${opts.name instanceof RegExp ? ` name~${opts.name.source}` : opts.name ? ` name=${String(opts.name)}` : ""}`),
    getByPlaceholder: (value: string, opts: { exact?: boolean } = {}) => found(`placeholder=${value}${opts.exact ? " exact" : ""}`),
    getByTestId: (value: string) => found(`testId=${value}`),
    getByLabel: (value: string, opts: { exact?: boolean } = {}) => found(`label=${value}${opts.exact ? " exact" : ""}`),
    getByText: (value: string, opts: { exact?: boolean }) => found(`text=${value}${opts.exact ? " exact" : ""}`),
    locator: (selector: string) => found(`css=${selector}`),
    frameLocator: (selector: string) => ({ ...surface, inFrame: selector }),
  };
  return surface;
};

const what = (spec: LocatorSpec): string => (locate(page() as never, spec) as unknown as { what: string }).what;

test("a bare string is a CSS selector", () => {
  equal(what("button.primary"), "css=button.primary");
});

test("a role and its accessible name is what a person sees", () => {
  // Substring by default, because a wording change nobody would notice should not fail a spec.
  equal(what({ role: "button", name: "Cancel order" }), "role=button name~Cancel order");
  equal(what({ role: "button", name: "Cancel", exact: true }), "role=button name=Cancel");
  equal(what({ role: "heading" }), "role=heading");
});

test("the other ways of naming a thing, in the order to prefer them", () => {
  equal(what({ placeholder: "Email" }), "placeholder=Email");
  equal(what({ testId: "chosen-slot" }), "testId=chosen-slot");
  equal(what({ label: "Date of birth" }), "label=Date of birth");
  equal(what({ text: "Cancelled" }), "text=Cancelled");
  equal(what({ text: "Cancelled", exact: true }), "text=Cancelled exact");
  equal(what({ css: "[data-state=open]" }), "css=[data-state=open]");
});

test("a label without htmlFor is reached from its label's sibling", () => {
  // `text-is`, not `has-text`: the latter is a substring match, so "Heading" would also take
  // "Confirmation heading" — several fields for one locator.
  equal(what({ labelledInput: "Heading" }), 'css=label:text-is("Heading") ~ input');
  match(what({ labelledTextarea: "Body" }), /label:text-is\("Body"\) ~ textarea or .*div textarea/);
});

test("exact means the same thing for every way of naming a thing", () => {
  // A field labelled "Password" also matches a button called "Show password", and the failure lands in
  // a spec that was specific enough — so `exact` has to reach the label and the placeholder too.
  equal(what({ label: "Password" }), "label=Password");
  equal(what({ label: "Password", exact: true }), "label=Password exact");
  equal(what({ placeholder: "Email", exact: true }), "placeholder=Email exact");
  equal(what({ text: "Cancelled", exact: true }), "text=Cancelled exact");
});

test("hasText narrows the matches, nth picks one", () => {
  equal(what({ css: "li", hasText: "the one" }), "css=li hasText=the one");
  equal(what({ css: "li", nth: 2 }), "css=li nth=2");
  equal(what({ css: "li", hasText: "x", nth: 0 }), "css=li hasText=x nth=0");
});

test("within scopes to something else first", () => {
  equal(what({ within: { role: "dialog" }, css: "input" }), "role=dialog >> css=input");
  equal(what({ within: { testId: "card" }, role: "button", name: "Open" }), "testId=card >> role=button");
});

test("a spec that names nothing says so, with the spec in the message", () => {
  throws(() => what({ nth: 1 }), /locator spec names nothing: \{"nth":1\}/);
});

test("describe is what the trace and the failure message read", () => {
  equal(describe("button.primary"), "button.primary");
  equal(describe({ role: "button", name: "Cancel" }), "role=button name=Cancel");
  // The scope and the exactness are noise in a one-line description.
  equal(describe({ role: "button", name: "Cancel", exact: true, within: { role: "dialog" } }), "role=button name=Cancel");
  deepEqual(describe({ css: "li", nth: 2 }), "css=li nth=2");
});
