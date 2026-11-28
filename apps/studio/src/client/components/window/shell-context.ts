import { type Draft } from "@/shared/drafts";
import { type TabId } from "@/shared/tabs";
import { type AppPlace } from "@/client/atoms/window";
import {
  type ChatId,
  type LayoutRead,
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import {
  type AIGatewayModelURI,
  type ModelChoice,
} from "@instrument-org/ai-gateway/client";

import { type Project } from "./chats";
import { type DraftSend } from "./use-drafts";

/**
 * What the window keeps once and every app tab reads: its lists, the drafts,
 * and the ways back into the window's own state from
 * inside a tab.
 */
export interface WindowShell {
  /** The chat a draft just became, marked in the inbox as it arrives. */
  arrivedId: ChatId | undefined;
  chatTitles: Map<ChatId, string>;
  /** Each task's title, for a tab standing on one. */
  childTitles: Map<StoreId.Session, string>;
  /** Closes a tab group, asking first when that stops a chat in it. */
  closeGroup: (group: string) => void;
  /** Closes the whole side a tab stands on, onto the closed list as one entry, asking first when that stops a chat on it. */
  closeSide: (tab: string) => void;
  /** The model a new chat starts on, and setting it. */
  defaultModelChoice: ModelChoice | undefined;
  defaultModelURI: AIGatewayModelURI.Type | undefined;
  /** Throws a draft away, with a moment to take it back. */
  discardDraft: (id: string) => void;
  /** The drafts worth coming back to, for the inbox. */
  drafts: Draft[];
  /** Takes the tab up to one of the rail's places, as a press on the rail does. */
  goToPlace: (place: AppPlace) => void;
  /** Brings up the window's empty tab group, or makes one, as Cmd+N does. */
  newGroup: () => void;
  /** Opens a new tab in the tab group up, as Cmd+T does. */
  newTab: () => void;
  /** A project asked for from a chat's menu, with what was typed: the project it makes files that chat. */
  onNewProject: (chatId: ChatId, name?: string) => void;
  /** A project asked for from a draft's menu, with what was typed: the project it makes files that draft. */
  onNewDraftProject: (draftId: string, name?: string) => void;
  setDefaultModelChoice: (choice: ModelChoice | undefined) => void;
  setDefaultModelURI: (modelURI: AIGatewayModelURI.Type) => void;
  /** Starts the chat a draft is for, from what its composer sends, in the tab it was written in. */
  startChat: (id: string, send: DraftSend, tabId: string) => void;
  /** Takes the tab up to Chat with the inbox standing in a project, by its id, putting away the chat or draft up beside it for a new chat filed under the project. */
  openProject: (projectId: string) => void;
  /** Opens a project's folder in Files. */
  openProjectInFiles: (project: Project) => void;
  /** Says a chat's transcript has what it was started with, so `sentWords` can let go of it. */
  sentStored: (chatId: ChatId) => void;
  /** What a chat being started from a draft sent, shown until its transcript has it. */
  sentWords: (chatId: ChatId) => string | undefined;
  /**
   * Brings back one entry of the window's closed list, by its id, as
   * Shift+Cmd+T brings back the last. With `from`, the group the pick was
   * made in, what comes back takes that group's place when it is one new
   * tab nobody wrote in, or the Chats page alone.
   */
  reopenClosed: (id: TabId, options?: { from?: string }) => void;
  /** What was closed last back, as Shift+Cmd+T does, a window closed since included. */
  reopenTab: () => void;
  /**
   * Brings a tab group up, in this window or the one that has it open. With
   * `from`, the group the pick was made in, that group closes behind it when
   * it is one new tab nobody wrote in, or the Chats page alone.
   */
  showGroup: (group: string, options?: { from?: string }) => void;
  /** Closes a tab, asking first when that stops its chat. */
  requestClose: (id: string, options?: { up?: string }) => void;
  /** The width of the card the tabs are drawn in, in layout px. */
  rowWidth: number;
  /**
   * The group of the tab a message goes from, as the chat reads it (`layoutReadOf`),
   * marking the tab as the one the chat was last sent from.
   */
  layoutContext: (tabId: string) => LayoutRead | undefined;
  /** What goes with a message in a chat; see `contextReaders`. */
  sendContext: (options: {
    chatId: ChatId;
    /** The chat's tab the message is written in, whose other side's tab up goes with it. */
    tabId?: string;
  }) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  setChatProject: (id: ChatId, project: null | string) => void;
  /**
   * Brings up the tab already writing a draft, in this window or another;
   * with none, `here` puts it up, by default in the tab up.
   */
  showDraft: (id: string, here?: () => void) => void;
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
