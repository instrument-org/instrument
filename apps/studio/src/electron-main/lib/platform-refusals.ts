import { type PlatformRefusal } from "@instrument-org/ai-gateway";

import { getToken } from "../platform-api/utils";

let last:
  | { refusal: PlatformRefusal; token: null | string | undefined }
  | undefined;

/**
 * The most recent hosted request our platform refused, from a chat turn's
 * proxied request or the billing debug page's own. In memory only: it
 * answers "what did the platform last say no with", not a history.
 */
export function recordPlatformRefusal(refusal: PlatformRefusal) {
  last = { refusal, token: getToken() };
}

/** The last refusal, while the account it was made for is still signed in. */
export function lastPlatformRefusal() {
  return last && last.token === getToken() ? last.refusal : undefined;
}
