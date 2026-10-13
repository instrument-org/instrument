import { type WorkspaceActorRef } from "../../machines/workspace";
import { startAppEvents } from "../apps/events";
import { setWorkspaceActorRef } from "../workspace-actor-ref";
import { startChatUnreadOnSettle } from "./chats";
import { startChatRetitle } from "./retitle";
import { startChatWake } from "./wake";

/**
 * Everything a chat needs from the process that owns the workspace
 * actor: a way for its `task` command to reach the machine, the subscribers
 * that wake it when a child finishes or the user acts on an app, the one
 * that names a chat again once its first exchange settles, and the one that
 * marks a chat unread each time it settles.
 * Called once per actor by whoever creates one, rather than by the machine
 * itself, so a test that builds a machine does not also start a subscriber
 * it never stops.
 */
export function attachChats(workspaceRef: WorkspaceActorRef): void {
  setWorkspaceActorRef(workspaceRef);
  startChatWake(workspaceRef);
  startAppEvents(workspaceRef);
  startChatRetitle();
  startChatUnreadOnSettle();
}
