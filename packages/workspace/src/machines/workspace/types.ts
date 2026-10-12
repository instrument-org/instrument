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
  // The lifetime of the window's browser guests, for as long as the
  // workspace runs.
  windowBrowserRef: WindowBrowserActorRef;
  chatsBeingTrashed: ChatId[];
  workspaceServerRef: WorkspaceServerActorRef;
}
