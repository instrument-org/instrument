import { type Draft } from "@/shared/drafts";
import { type AppPlace } from "@/client/atoms/window";
import {
  type ChatId,
  type LayoutSent,
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";

import { type Project } from "./chats";
import { type DraftSend } from "./compose-window";
import { type ContextItem } from "./context-items";
import { type useCompose } from "./use-compose";

/**
 * What the window keeps once and every app tab reads: its lists, the drafts
 * and floating windows, and the ways back into the window's own state from
 * inside a tab.
 */
export interface WindowShell {
  /** The chat a draft just became, marked in the inbox as it arrives. */
  arrivedId: ChatId | undefined;
  chatTitles: Map<ChatId, string>;
  /** Each task's title, for a tab standing on one. */
  childTitles: Map<StoreId.Session, string>;
  /** Closes a tab group to History, asking first while its agent works. */
  closeGroup: (group: string) => void;
  compose: ReturnType<typeof useCompose>;
  /** The model a new chat starts on, and setting it. */
  defaultModelURI: AIGatewayModelURI.Type | undefined;
  /** Throws a draft away, with a moment to take it back. */
  discardDraft: (id: string) => void;
  /** The drafts worth coming back to, for the inbox. */
  drafts: Draft[];
  /** Takes the tab up to one of the rail's places, as a press on the rail does. */
  goToPlace: (place: AppPlace) => void;
  /** Makes a new tab group, as Cmd+N does. */
  newGroup: () => void;
  /** Opens a new tab in the tab group up, as Cmd+T does. */
  newTab: () => void;
  /** A project asked for from a chat's head, with what was typed. */
  onNewProject: (name: string | undefined) => void;
  /** A project asked for from a draft's head, with what was typed: the project it makes files that draft. */
  onNewDraftProject: (draftId: string, name: string) => void;
  /** Sends the draft the Chat screen is writing to a window along the foot. */
  popOutDraft: (id: string) => void;
  setDefaultModelURI: (modelURI: AIGatewayModelURI.Type) => void;
  /** Starts the chat a draft is for, from what its composer sends. */
  startChat: (id: string, send: DraftSend) => void;
  /** Takes the tab up to Chat with the inbox standing in a project, by its id, putting away the chat or draft up beside it for a new chat filed under the project. */
  openProject: (projectId: string) => void;
  /** Takes the inbox back out of its project, to the chat or draft up before it while the project's new chat is still unwritten. */
  leaveProject: () => void;
  /** Opens a project's folder in Files. */
  openProjectInFiles: (project: Project) => void;
  /** The project each chat being started from a draft was sent under, by the chat, worn by its head until its record files it. */
  sentProjects: ReadonlyMap<ChatId, string>;
  /** What each chat being started from a draft sent, by the chat, shown until its transcript has it. */
  sentWords: ReadonlyMap<ChatId, string>;
  /** Closes one of a chat's tabs, asking first while a task is working in it. */
  requestClose: (id: string) => void;
  /** The width of the card the tabs are drawn in, in layout px. */
  rowWidth: number;
  /** A chat's tab group as a message goes from it, and what changed there; see `layoutReader`. */
  layoutContext: (group: string) => LayoutSent | undefined;
  /** What goes with a message in a chat; see `contextReaders`. */
  sendContext: (options: {
    chatId: ChatId;
    isViewOpen: boolean;
    taken: readonly ContextItem[];
  }) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  setChatProject: (id: ChatId, project: null | string) => void;
  setPaneOpen: (group: string, isOpen: boolean) => void;
  showDraft: (id: string) => void;
  projects: Project[];
}

export const ShellContext = createContext<null | WindowShell>(null);

export function useShell(): WindowShell {
  const value = useContext(ShellContext);
  if (!value) {
    throw new Error("useShell is only for the tabs of the app window");
  }
  return value;
}
