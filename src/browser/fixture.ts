import * as path from "node:path";

import type { BrowserContext, test as base } from "@playwright/test";

import { requirePlaywright } from "./playwright.ts";

import type { System } from "../system.ts";

/**
 * The test object, built from the config's identities.
 *
 * Staff-facing apps commonly trust a signed or plain identity cookie in local development; where the
 * config declares one, every context the system opens carries it, and a spec never sees a login form
 * or handles an admin password. An identity with no cookies is just data (a service account, an email
 * to match against) and is ignored here.
 *
 * Members are not identities — they are the cast, and they sign in for real (`app.<app>.signIn`).
 */
export function testFor(system: System): typeof base {
  const { test } = requirePlaywright("the test fixture");
  const cookies = Object.values(system.config.identities ?? {}).flatMap(identity =>
    (identity.cookies ?? []).map(cookie => ({
      name: cookie.name,
      value: cookie.json !== undefined
        ? cookie.urlEncode
          ? encodeURIComponent(JSON.stringify(cookie.json))
          : JSON.stringify(cookie.json)
        : (cookie.value ?? ""),
      domain: cookie.domain ?? "localhost",
      path: cookie.path ?? "/",
    })),
  );

  return test.extend<{ evidenceManifest: void }>({
    context: async ({ context }: { context: BrowserContext }, use: (c: BrowserContext) => Promise<void>) => {
      if (cookies.length) await context.addCookies(cookies);
      await use(context);
    },

    /**
     * Every test says where its artefacts belong, whether or not it takes any.
     *
     * Written before the test runs, so a recording is filed correctly even when the test never takes a
     * frame — including when it FAILS before reaching one, which is exactly when someone goes looking
     * for the video.
     */
    evidenceManifest: [
      async ({}, use: (v: void) => Promise<void>, testInfo: { attach: (name: string, opts: { path: string; contentType: string }) => Promise<void> }) => {
        const evidence = system.evidence();
        evidence.writeManifest();
        await use();

        // Whatever the run wrote up, handed to the runner's own reporters. `testInfo.attach` is how an
        // artefact reaches an HTML report or a CI annotation, and a story nobody can find from the
        // report is a story written for a directory listing.
        for (const file of evidence.stories()) {
          const contentType = file.endsWith(".json") ? "application/json" : "text/markdown";
          await testInfo.attach(path.relative(evidence.dir, file), { path: file, contentType }).catch(() => undefined);
        }
      },
      { auto: true },
    ],
  }) as typeof base;
}
