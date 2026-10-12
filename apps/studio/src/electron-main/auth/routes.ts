/** Stable loopback paths used by the providers and the Instrument API. */
export const AUTH_CALLBACK_PATHS = {
  // OpenAI fixes the scheme, host and path of ChatGPT's redirect; only the
  // port may vary.
  chatgpt: "/auth/callback",
  instrument: "/auth/callback/instrument",
  openrouter: "/auth/callback/openrouter",
  app: "/auth/callback/app",
} as const;
