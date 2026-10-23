/** Stable loopback paths used by the providers and the Instrument API. */
export const AUTH_CALLBACK_PATHS = {
  // OpenAI fixes the scheme, host and path of ChatGPT's redirect; only the
  // port may vary.
  chatgpt: "/auth/callback",
  instrument: "/auth/callback/instrument",
  openrouter: "/auth/callback/openrouter",
  app: "/auth/callback/app",
} as const;

/**
 * Where the website's Open Instrument buttons send the browser: brings the
 * window forward, and with `?step=subscriptions` takes a sign-up that went
 * on to the website back to the subscriptions in setup.
 */
export const APP_OPEN_PATH = "/open";
