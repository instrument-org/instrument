import { type WorkspaceServerActorRef } from "../../logic/server";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceConfig } from "../../types";
import { type SessionActorRef } from "../session";
import { type ChatBrowserActorRef } from "../chat-browser";

// Declared here to avoid circular dependency
export interface WorkspaceContext {
  config: WorkspaceConfig;
  error?: unknown;
  // Resolvers waiting for the chatBrowser at `id` to reach Stopped
  // before trashChat deletes the directory. Drained when the matching
  // chatBrowser.stopped event arrives (or immediately if no machine
  // existed when prepareToTrashChat ran).
  pendingBrowserReapResolvers: Map<ChatId, (() => void)[]>;
  sessionRefsByChatId: Map<ChatId, SessionActorRef[]>;
  // One chatBrowser actor per chat id with browser activity or an
  // active chat-page presence subscription. Spawned lazily and reaped on
  // chatBrowser.stopped.
  chatBrowserRefs: Map<ChatId, ChatBrowserActorRef>;
  chatsBeingTrashed: ChatId[];
  workspaceServerRef: WorkspaceServerActorRef;
}
