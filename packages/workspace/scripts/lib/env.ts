import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  client: {},
  clientPrefix: "PUBLIC_",
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    APP_AI_GATEWAY_API_KEY: z.string().optional(),
    APP_ANTHROPIC_API_KEY: z.string().optional(),
    APP_CEREBRAS_API_KEY: z.string().optional(),
    APP_GOOGLE_API_KEY: z.string().optional(),
    APP_GROQ_API_KEY: z.string().optional(),
    APP_OPENAI_API_KEY: z.string().optional(),
    APP_OPENROUTER_API_KEY: z.string().optional(),
    APP_REGISTRY_DIR_PATH: z.string().optional(),
    APP_ZAI_API_KEY: z.string().optional(),
  },
});
