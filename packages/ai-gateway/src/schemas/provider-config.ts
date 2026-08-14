// FYI this module is used on the client, so no node imports
import {
  type AI_GATEWAY_API_KEY_NOT_NEEDED,
  AIProviderConfigIdSchema,
  AIProviderTypeSchema,
} from "@instrument-org/shared";
import { z } from "zod";

export namespace AIGatewayProviderConfig {
  export const Schema = z.object({
    // For easy auto-completion
    apiKey: z.custom<(string & {}) | typeof AI_GATEWAY_API_KEY_NOT_NEEDED>(
      (v) => typeof v === "string",
    ),
    baseURL: z.string().optional(),
    cacheIdentifier: z.string(),
    displayName: z.string().optional(),
    id: AIProviderConfigIdSchema,
    type: AIProviderTypeSchema,
  });
  export type Type = z.output<typeof Schema>;
}

/**
 * The keys a test plants a ready-made model under, so resolving a model off a
 * provider config returns it instead of going to the network.
 *
 * They sit beside the config they are stamped onto rather than beside the code
 * that reads them, which lives among the AI SDK providers: a test helper needs
 * the names and nothing else, and this module is a leaf.
 */
export const TEST_MODEL_OVERRIDE_KEY = "__testModelOverride";
export const TEST_IMAGE_MODEL_OVERRIDE_KEY = "__testImageModelOverride";
export const TEST_WEB_SEARCH_MODEL_OVERRIDE_KEY =
  "__testWebSearchModelOverride";
