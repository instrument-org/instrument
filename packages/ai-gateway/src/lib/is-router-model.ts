import { OUR_MODELS } from "@instrument-org/shared";

/**
 * Models whose whole job is to be something else. A request naming one of
 * these asks for a decision rather than for a model, so the model that answers
 * it is the router working rather than the provider substituting.
 *
 * An allowlist because nothing in a model record says so yet. The catalog is
 * the right place for it -- our gateway already sends a namespaced `instrument`
 * object alongside each model, and a flag there would cover routers we have
 * never heard of -- but a user's own OpenRouter key returns OpenRouter's
 * catalog untouched, so those two ids need naming here regardless.
 */
const ROUTER_PROVIDER_IDS = new Set<string>([
  "openrouter/auto",
  "openrouter/auto-beta",
  OUR_MODELS.text.id,
]);

export function isRouterModel(
  model: undefined | { providerId: string },
): boolean {
  return model ? ROUTER_PROVIDER_IDS.has(model.providerId) : false;
}
