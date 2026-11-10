import { type BrowserTargetId } from "../../types";
import { tabsActedInBy } from "../tab-activity";
import { workingIn } from "./chat-tabs";

/**
 * Whether an agent with a turn running right now has driven the tab: any
 * session of any chat, since every session of a chat drives every tab of it.
 * Only tabs an agent sent commands are read, so it costs nothing while none
 * has.
 */
export function isDrivenByWorkingAgent(
  targetId: BrowserTargetId,
): Promise<boolean> {
  return Promise.resolve(workingIn(targetId).length > 0);
}

/**
 * Whether an agent with a turn running is at work in the tab now: of the
 * tabs that session sent commands, the one it sent its latest. A tab its
 * sessions have all moved on from, or whose sessions have stopped, is not.
 */
export function isWorkedInNow(targetId: BrowserTargetId): boolean {
  return workingIn(targetId).some(
    ({ sessionId }) => tabsActedInBy(sessionId)[0] === targetId,
  );
}
