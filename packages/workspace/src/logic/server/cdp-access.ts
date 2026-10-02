import { randomBytes, timingSafeEqual } from "node:crypto";

import { LOCALHOST_APPS_SERVER_DOMAIN, LOOPBACK_HOST } from "./constants";

/**
 * The CDP bridge drives the person's signed-in in-app browser, so every
 * request to it carries this launch's key, minted once per process like the
 * model proxy's internal key. Only the harness hands it out: agent-browser
 * gets it inside the provider plugin's URL, and the shell scrubs it from
 * anything the agent reads back.
 */
const CDP_KEY = randomBytes(32).toString("hex");
const CDP_KEY_PARAM = "key";

export function cdpBridgeKey(): string {
  return CDP_KEY;
}

/** A bridge URL with this launch's key, for the clients the harness starts. */
export function withCdpBridgeKey(url: string): string {
  return `${url}?${CDP_KEY_PARAM}=${CDP_KEY}`;
}

/**
 * Whether a request to the bridge came from a client the harness started.
 *
 * - The key must match: a page or another local user cannot learn it.
 * - No `Origin`: every browser sends one on a WebSocket upgrade or a
 *   cross-origin fetch, `null` included, and agent-browser sends none.
 * - `Host` must name loopback, so a rebound DNS name pointing at 127.0.0.1
 *   cannot reach the bridge from a page on that name.
 */
export function isAuthorizedCdpRequest({
  host,
  origin,
  url,
}: {
  host: string | undefined;
  origin: string | undefined;
  url: string | undefined;
}): boolean {
  if (origin !== undefined || host === undefined || url === undefined) {
    return false;
  }
  const hostname = host.replace(/:\d+$/, "");
  if (hostname !== LOOPBACK_HOST && hostname !== LOCALHOST_APPS_SERVER_DOMAIN) {
    return false;
  }
  const key = new URL(url, `http://${LOOPBACK_HOST}`).searchParams.get(
    CDP_KEY_PARAM,
  );
  if (key === null) {
    return false;
  }
  const given = Buffer.from(key);
  const expected = Buffer.from(CDP_KEY);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
