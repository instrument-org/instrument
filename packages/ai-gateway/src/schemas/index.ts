/**
 * The schemas on their own, reachable as `@instrument-org/ai-gateway/schemas`.
 *
 * The package root also exports all of this, but it exports the gateway's Hono
 * app and the model-fetching stack alongside it, so a module that wants a Zod
 * schema or one of the provider-config keys pulls every AI SDK provider in with
 * it. That is around a second of module evaluation, which a bundler drops but a
 * test runner pays once per test file, since each one gets its own registry.
 */
export * from "./model";
export * from "./model-uri";
export * from "./provider-config";
export * from "./provider-metadata";
