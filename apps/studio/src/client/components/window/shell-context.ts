import { type Draft } from "@/client/atoms/window";
import {
  type SessionMessageDataPart,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type useAppTabs } from "./app-tabs";
import { type PageChromeSlots } from "./browser-tabs";
import { type Chat, type Topic } from "./chats";
import { type useCompose } from "./use-compose";

/**
 * Where the tab on screen wants the window's page drawn: the element the
 * page lies over, the row its reload and controls go into, and whether the
 * page is what the tab shows right now. A tab with no page to show reports
 * nothing.
 */
export interface PageSlot {
  chrome: PageChromeSlots | undefined;
  host: HTMLElement | null;
  isShown: boolean;
}

/**
 * What the window keeps once and every app tab reads: its lists, the drafts
 * and floating windows, and the ways back into the window's own state from
 * inside a tab.
 */
export interface WindowShell {
  appTabs: ReturnType<typeof useAppTabs>;
  /** The chat a draft just became, marked in the inbox as it arrives. */
  arrivedId: StoreId.Session | undefined;
  chats: Chat[] | undefined;
  chatTitles: Map<StoreId.Session, string>;
  /** Each task's title, for a tab standing on one. */
  childTitles: Map<TaskId, string>;
  compose: ReturnType<typeof useCompose>;
  deleteDraft: (id: string) => void;
  /** The drafts worth coming back to, for the inbox. */
  drafts: Draft[];
  /** Opens a new draft, as the rail's New does. */
  newDraft: () => void;
  /** The inbox's rows as it lists them, for stepping through them by chord. */
  onListed: (listed: StoreId.Session[]) => void;
  /** A topic asked for from a chat's head, with what was typed. */
  onNewTopic: (name: string | undefined) => void;
  /** What each chat being started from a draft sent, by the chat, shown until its transcript has it. */
  sentWords: ReadonlyMap<StoreId.Session, string>;
  /** Where the tab on screen wants the page drawn; null for none. */
  reportPageSlot: (slot: null | PageSlot) => void;
  /** Closes one of a chat's tabs, asking first while a task is working in it. */
  requestClose: (id: string) => void;
  /** The width of the card the tabs are drawn in, in layout px. */
  rowWidth: number;
  /** What goes with a message in a chat; see `contextReaders`. */
  sendContext: (options: {
    isViewOpen: boolean;
    sessionId: StoreId.Session;
  }) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  setChatTopics: (id: StoreId.Session, topics: string[]) => void;
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
