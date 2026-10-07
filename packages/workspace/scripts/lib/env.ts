import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  client: {},
  clientPrefix: "PUBLIC_",
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    // The platform's own gateway, the provider a signed-in Studio runs on: a
    // session token and the API's `/gateway/openrouter` base.
    APP_AI_API_KEY: z.string().optional(),
    APP_AI_BASE_URL: z.string().optional(),
    APP_AI_GATEWAY_API_KEY: z.string().optional(),
    APP_ANTHROPIC_API_KEY: z.string().optional(),
    APP_CEREBRAS_API_KEY: z.string().optional(),
    // A ChatGPT plan access token, as `script:chatgpt-plan-token` prints it.
    APP_CHATGPT_PLAN_TOKEN: z.string().optional(),
    // The `claude` CLI a Claude account runs through, signed in to a Claude
    // subscription, as Studio would find it.
    APP_CLAUDE_CODE_PATH: z.string().optional(),
    APP_GOOGLE_API_KEY: z.string().optional(),
    APP_GROQ_API_KEY: z.string().optional(),
    APP_OPENAI_API_KEY: z.string().optional(),
    APP_OPENCODE_GO_API_KEY: z.string().optional(),
    APP_OPENCODE_ZEN_API_KEY: z.string().optional(),
    APP_OPENROUTER_API_KEY: z.string().optional(),
    APP_REGISTRY_DIR_PATH: z.string().optional(),
    APP_ZAI_API_KEY: z.string().optional(),
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_WORKERS_AI_API_KEY: z.string().optional(),
    FORCE_COLOR: z.string().optional(),
    NO_COLOR: z.string().optional(),
  },
});
