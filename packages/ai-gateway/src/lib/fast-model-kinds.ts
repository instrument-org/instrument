import { OUR_MODELS } from "@instrument-org/shared";

/** The connections with a fast model a side call may spend: flat-fee plans and our own. */
const FAST_MODEL_TYPES: ReadonlySet<string> = new Set([
  "chatgpt-account",
  "claude-account",
  OUR_MODELS.providerType,
]);

/** Whether a connection of this type has a fast model for side calls. */
export function hasFastModel(type: string): boolean {
  return FAST_MODEL_TYPES.has(type);
}
