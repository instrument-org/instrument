import { type WorkspaceActorRef } from "../../machines/workspace";
import { startAppEvents } from "../apps/events";
import { startChatFolderWrites } from "../chat-folders/on-turn-end";
import { setWorkspaceActorRef } from "../workspace-actor-ref";
import { startChatListFile } from "./chat-list-file";
import { startChatUnreadOnSettle } from "./chats";
import { startJobWake } from "./job-wake";
import { startChatRetitle } from "./retitle";
import { startSignInWake } from "./sign-in-wake";
import { startChatWake } from "./wake";
import { startWorkDirReap } from "./work-dir-reap";

/**
 * Everything a chat needs from the process that owns the workspace
 * actor: a way for its `task` command to reach the machine, the subscribers
 * that wake it when a child finishes, a background process it left running
 * ends, the user acts on an app, or signs in to Instrument for an image it
 * asked for, the one
 * that names a chat again once its first exchange settles, the one that
 * marks a chat unread each time it settles, the one that writes the
 * chat's transcript into its folder as each turn ends, the one that
 * removes a work folder a chat at rest left empty, and the one that writes
 * this device's chat list into the workspace for a phone to open it from.
 * Called once per actor by whoever creates one, rather than by the machine
 * itself, so a test that builds a machine does not also start a subscriber
 * it never stops.
 */
export function attachChats(workspaceRef: WorkspaceActorRef): void {
  setWorkspaceActorRef(workspaceRef);
  startChatWake(workspaceRef);
  startJobWake(workspaceRef);
  startAppEvents(workspaceRef);
  startSignInWake(workspaceRef);
  startChatRetitle();
  startChatUnreadOnSettle();
  startChatFolderWrites();
  startWorkDirReap(workspaceRef);
  startChatListFile();
}
