import { type Draft } from "@/shared/drafts";
import { type AppPlace } from "@/client/atoms/window";
import {
  type ChatId,
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type useAppTabs } from "./app-tabs";
import { type Chat, type Topic } from "./chats";
import { type useCompose } from "./use-compose";

/**
 * What the window keeps once and every app tab reads: its lists, the drafts
 * and floating windows, and the ways back into the window's own state from
 * inside a tab.
 */
export interface WindowShell {
  appTabs: ReturnType<typeof useAppTabs>;
  /** The chat a draft just became, marked in the inbox as it arrives. */
  arrivedId: ChatId | undefined;
  chats: Chat[] | undefined;
  chatTitles: Map<ChatId, string>;
  /** Each task's title, for a tab standing on one. */
  childTitles: Map<StoreId.Session, string>;
  compose: ReturnType<typeof useCompose>;
  /** Throws a draft away, with a moment to take it back. */
  discardDraft: (id: string) => void;
  /** The drafts worth coming back to, for the inbox. */
  drafts: Draft[];
  /** Takes the tab up to one of the rail's places, as a press on the rail does. */
  goToPlace: (place: AppPlace) => void;
  /** Opens a new draft, as the rail's New does. */
  newDraft: () => void;
  /** The inbox's rows as it lists them, for stepping through them by chord. */
  onListed: (listed: ChatId[]) => void;
  /** A topic asked for from a chat's head, with what was typed. */
  onNewTopic: (name: string | undefined) => void;
  /** Takes the tab up to Chat with the inbox standing in a topic, by its id. */
  openTopic: (topicId: string) => void;
  /** What each chat being started from a draft sent, by the chat, shown until its transcript has it. */
  sentWords: ReadonlyMap<ChatId, string>;
  /** Closes one of a chat's tabs, asking first while a task is working in it. */
  requestClose: (id: string) => void;
  /** The width of the card the tabs are drawn in, in layout px. */
  rowWidth: number;
  /** What goes with a message in a chat; see `contextReaders`. */
  sendContext: (options: {
    chatId: ChatId;
    isPoppedOut: boolean;
    isViewOpen: boolean;
    leftOut: readonly string[];
  }) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  setChatTopic: (id: ChatId, topic: null | string) => void;
  setPaneOpen: (group: string, isOpen: boolean) => void;
  showDraft: (id: string) => void;
  topics: Topic[];
}

export const ShellContext = createContext<null | WindowShell>(null);

export function useShell(): WindowShell {
  const value = useContext(ShellContext);
  if (!value) {
    throw new Error("useShell is only for the tabs of the app window");
  }
  return value;
}
