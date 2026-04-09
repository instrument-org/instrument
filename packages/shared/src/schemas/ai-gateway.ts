import { z } from "zod";

import { OUR_MODELS, type OUR_PROVIDER_CONFIG } from "../constants";

export const AIProviderTypeSchema = z.enum([
  "anthropic",
  "anyscale",
  "cerebras",
  "deepinfra",
  "deepseek",
  "fireworks",
  "minimax",
  "google",
  "groq",
  "huggingface",
  "hyperbolic",
  "jan",
  "lmstudio",
  "localai",
  "mistral",
  "novita",
  "ollama",
  "openai-compatible",
  "openai",
  "openrouter",
  "perplexity",
  OUR_MODELS.providerType,
  "together",
  "vercel",
  "x-ai",
  "z-ai",
]);
export type AIProviderType = z.infer<typeof AIProviderTypeSchema>;

// Our provider type is a special case and only has one config ID that correlates to the
// logged in user.
export const AIProviderConfigIdSchema = z.custom<
  (string & z.$brand<"AIProviderConfigId">) | typeof OUR_PROVIDER_CONFIG.id
>((val) => typeof val === "string");
export type AIProviderConfigId = z.output<typeof AIProviderConfigIdSchema>;
