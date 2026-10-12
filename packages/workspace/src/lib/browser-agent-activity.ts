import { publisher } from "../rpc/publisher";
import { type ChatId } from "../schemas/chat-id";
import { type BrowserTargetId } from "../types";

/** How many guests' last activity is kept; the oldest go first past it. */
const KEPT = 256;

/** When each guest last had an agent's command, oldest first. */
const lastAt = new Map<BrowserTargetId, number>();

/** When an agent last worked in a guest, in ms, or nothing when none has since launch. */
export function lastBrowserAgentActivity(
  targetId: BrowserTargetId,
): number | undefined {
  return lastAt.get(targetId);
}

/**
 * An agent sent a guest a command, or opened it: told to everyone listening,
 * and kept, so a listener that starts afterwards (a tile drawn once the tab
 * already exists) knows how long ago it was.
 */
export function noteBrowserAgentActivity(
  id: ChatId,
  targetId: BrowserTargetId,
): void {
  lastAt.delete(targetId);
  lastAt.set(targetId, Date.now());
  for (const oldest of lastAt.keys()) {
    if (lastAt.size <= KEPT) {
      break;
    }
    lastAt.delete(oldest);
  }
  publisher.publish("browser.agentActivity", { id, targetId });
}
