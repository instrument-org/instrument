/** Stable loopback paths used by the providers and the Instrument API. */
export const AUTH_CALLBACK_PATHS = {
  chatgpt: "/auth/callback",
  instrument: "/auth/callback/instrument",
  openrouter: "/auth/callback/openrouter",
  app: "/auth/callback/app",
} as const;
