/**
 * The pluggable half.
 *
 * Everything that meets the outside world is a provider the config picks BY NAME, so a second way of
 * doing any of them is a registration rather than an edit to the system.
 */
export { Registry } from "./registry.ts";
export { authHeaders, authProviders, type AuthConfig, type AuthProvider } from "./auth.ts";
export { clientProviders, type ClientConfig, type ClientProvider, type FailureWhen, type OperationConfig } from "./clients.ts";
export { resolveSecret, secretProviders, type SecretProvider, type SecretSource } from "./secrets.ts";
export { stubProviders, StubServer, type StubConfig, type StubProvider, type StubRoute } from "./stubs.ts";
export { videoProviders, type VideoConfig, type VideoProvider } from "./video.ts";
