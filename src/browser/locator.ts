import type { FrameLocator, Locator, Page } from "@playwright/test";

/**
 * How a step says which thing on the page it means.
 *
 * Declarative because the steps are: a config file has no place for `page.getByRole(...)`. The order
 * here is the order to prefer them in — a role and its accessible name is what a person sees, a CSS
 * selector is what survives worst.
 */
export type LocatorSpec =
  | string
  | {
      role?: string;
      name?: string;
      /** Match the name exactly rather than as a substring. */
      exact?: boolean;
      placeholder?: string;
      testId?: string;
      label?: string;
      text?: string;
      css?: string;
      /** A CSS selector for a labelled field whose input is a sibling — forms without `htmlFor`. */
      labelledInput?: string;
      labelledTextarea?: string;
      /** Narrow to the nth match (0-based), or `first`. */
      nth?: number;
      /** Scope to something else first — a dialog, a card, a section. */
      within?: LocatorSpec;
      /** Scope into a cross-origin iframe (a payment form, an embedded booking widget). */
      frame?: string;
      /** Filter the matches down to the ones containing this text. */
      hasText?: string;
    };

/** Resolve a spec against a page. `string` is treated as a CSS selector. */
export function locate(page: Page, spec: LocatorSpec): Locator {
  if (typeof spec === "string") return page.locator(spec);

  const root: Page | FrameLocator | Locator = spec.frame
    ? page.frameLocator(spec.frame)
    : spec.within
      ? locate(page, spec.within)
      : page;

  const name = spec.name ? (spec.exact ? { name: spec.name, exact: true } : { name: new RegExp(spec.name) }) : {};
  let found: Locator;
  if (spec.role) found = (root as Page).getByRole(spec.role as Parameters<Page["getByRole"]>[0], name);
  else if (spec.placeholder) found = (root as Page).getByPlaceholder(spec.placeholder);
  else if (spec.testId) found = (root as Page).getByTestId(spec.testId);
  else if (spec.label) found = (root as Page).getByLabel(spec.label);
  else if (spec.text) found = (root as Page).getByText(spec.text, spec.exact ? { exact: true } : {});
  // Labels rendered without `htmlFor`: reach the field from its label's sibling. `text-is`, not
  // `has-text`, because the latter is a substring match and "Heading" would also take "Confirmation
  // heading" — several fields for one locator.
  else if (spec.labelledInput) found = (root as Page).locator(`label:text-is("${spec.labelledInput}") ~ input`);
  else if (spec.labelledTextarea)
    found = (root as Page)
      .locator(`label:text-is("${spec.labelledTextarea}") ~ textarea`)
      .or((root as Page).locator(`label:text-is("${spec.labelledTextarea}") ~ div textarea`));
  else if (spec.css) found = (root as Page).locator(spec.css);
  else throw new Error(`locator spec names nothing: ${JSON.stringify(spec)}`);

  if (spec.hasText) found = found.filter({ hasText: spec.hasText });
  if (spec.nth !== undefined) found = found.nth(spec.nth);
  return found;
}

/** A short human description, for the trace and for an error message. */
export function describe(spec: LocatorSpec): string {
  if (typeof spec === "string") return spec;
  const parts = Object.entries(spec)
    .filter(([k, v]) => v !== undefined && k !== "within" && k !== "exact")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.join(" ");
}
