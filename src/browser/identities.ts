import type { IdentityConfig } from "../config/schema.ts";

/**
 * The cookies the config's identities declare, for every browser context this tool opens.
 *
 * What a run can BE before it starts. Staff-facing apps commonly trust a signed or plain identity
 * cookie in local development; where the config declares one, every context this tool opens carries
 * it, and no run has to drive a login form it was not there to look at.
 *
 * An identity with no cookies is just data (a service account, an email to match against) and is
 * ignored here. Members are not identities — they are the cast, and they sign in for real.
 */
export function identityCookies(identities: Record<string, IdentityConfig> | undefined): {
  name: string;
  value: string;
  domain: string;
  path: string;
}[] {
  return Object.values(identities ?? {}).flatMap(identity =>
    (identity.cookies ?? []).map(cookie => ({
      name: cookie.name,
      value:
        cookie.json !== undefined
          ? cookie.urlEncode
            ? encodeURIComponent(JSON.stringify(cookie.json))
            : JSON.stringify(cookie.json)
          : (cookie.value ?? ""),
      domain: cookie.domain ?? "localhost",
      path: cookie.path ?? "/",
    })),
  );
}
