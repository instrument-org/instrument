import { type WorkspaceServerActorRef } from "../../logic/server";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceConfig } from "../../types";
import { type SessionActorRef } from "../session";
import { type WindowBrowserActorRef } from "../window-browser";

// Declared here to avoid circular dependency
export interface WorkspaceContext {
  config: WorkspaceConfig;
  error?: unknown;
  sessionRefsByChatId: Map<ChatId, SessionActorRef[]>;
  // The window's browser machine while it has a page or a viewer. Spawned
  // lazily and dropped on windowBrowser.stopped.
  windowBrowserRef: null | WindowBrowserActorRef;
  chatsBeingTrashed: ChatId[];
  workspaceServerRef: WorkspaceServerActorRef;
}
