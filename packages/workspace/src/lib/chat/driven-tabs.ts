import { type BrowserTargetId } from "../../types";
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
