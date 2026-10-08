import { randomBytes, timingSafeEqual } from "node:crypto";

import { CDP_BASE_PATH } from "./constants";

/**
 * A secret drawn once per launch that every CDP bridge path carries. The
 * bridge listens on loopback, where any process of any user on the machine can
 * reach it, and the ids after it (task ids, target ids) are guessable, so the
 * path alone has to be something only this process handed out. It reaches
 * agent-browser through the provider plugin's argv and nowhere else.
 */
const CDP_BRIDGE_SECRET = randomBytes(32).toString("base64url");

const TASK_SEGMENT = "/devtools/task/";

/** The bridge URL for a task's browser, on the port the workspace server bound. */
export function cdpBridgeUrl(port: number, taskId: string): string {
  return `ws://127.0.0.1:${port}${CDP_BASE_PATH}/${CDP_BRIDGE_SECRET}${TASK_SEGMENT}${taskId}`;
}

/**
 * The task a bridge path names, when it carries this launch's secret.
 * Undefined for a path outside the bridge, `"refused"` for one inside it with
 * a missing or wrong secret or an unknown shape. The id is returned unparsed;
 * the caller validates it.
 */
export function parseCdpBridgePath(
  url: string | undefined,
): { taskId: string } | "refused" | undefined {
  const pathname = url?.split("?")[0];
  if (!pathname?.startsWith(`${CDP_BASE_PATH}/`)) {
    return undefined;
  }
  const rest = pathname.slice(CDP_BASE_PATH.length + 1);
  const slash = rest.indexOf("/");
  if (slash === -1 || !isBridgeSecret(rest.slice(0, slash))) {
    return "refused";
  }
  const after = rest.slice(slash);
  return after.startsWith(TASK_SEGMENT)
    ? { taskId: after.slice(TASK_SEGMENT.length) }
    : "refused";
}

function isBridgeSecret(candidate: string): boolean {
  const given = Buffer.from(candidate);
  const expected = Buffer.from(CDP_BRIDGE_SECRET);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
