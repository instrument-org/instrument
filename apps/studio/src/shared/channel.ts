import { type AppChannel } from "@instrument-org/shared";

// Injected at build time by electron-vite `define` (see electron.vite.config.ts).
// Defaults to "stable" for local/dev builds.
declare const __INSTRUMENT_CHANNEL__: string;

export const BUILD_CHANNEL: AppChannel =
  __INSTRUMENT_CHANNEL__ === "canary" ? "canary" : "stable";

export const IS_CANARY = BUILD_CHANNEL === "canary";
