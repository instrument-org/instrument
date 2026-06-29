import { BUILD_CHANNEL } from "@/shared/channel";

// Injected at build time by electron-vite `define` (see electron.vite.config.ts).
// Empty in local/dev builds; populated by the canary workflow from the git
// context so the running app can show exactly which commit it came from.
declare const __BUILD_SHA__: string;
declare const __BUILD_BRANCH__: string;
declare const __BUILD_DATE__: string;

export const BUILD_INFO = {
  branch: __BUILD_BRANCH__,
  channel: BUILD_CHANNEL,
  date: __BUILD_DATE__,
  sha: __BUILD_SHA__,
} as const;
