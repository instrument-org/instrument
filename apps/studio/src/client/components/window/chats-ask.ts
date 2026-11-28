import { resetStudioModals } from "@/client/atoms/studio-modal";
import { atom, getDefaultStore } from "jotai";

import { type ChatPlace } from "./chats";
import { matchScreen } from "./window-href";

/** Which chats a side panel opens on: a project's, a place's, or words to search for. */
export interface ChatsAsk {
  /** Put the caret in the panel's search. */
  focus?: boolean;
  place?: ChatPlace;
  project?: string;
  search?: string;
}

/**
 * The chats asked for from anywhere in the window, a chord, a link or a
 * call outside React included, which the window shows in the side panel of
 * the group up (`useChatsAsks`) and clears.
 */
export const chatsAskAtom = atom<ChatsAsk | null>(null);

/**
 * Shows chats in the side panel of the group up, closing whatever dialog
 * is up: every chat, or the ones `ask` narrows to.
 */
export function showChatsInPanel(ask: ChatsAsk = {}) {
  resetStudioModals();
  getDefaultStore().set(chatsAskAtom, { ...ask });
}

/**
 * The chats an address of the chat list names (`/chat-list`, with a
 * `project`, a `place` or words `q` to search for), which the side panel
 * shows; nothing for any other address.
 */
export function chatsAskOf(href: string): ChatsAsk | undefined {
  const screen = matchScreen(href);
  if (screen.kind !== "chats") {
    return undefined;
  }
  const query = new URL(href, "http://x").searchParams;
  const place = query.get("place");
  const search = query.get("q");
  return {
    ...(place === "archived" || place === "drafts" ? { place } : {}),
    ...(screen.project === undefined ? {} : { project: screen.project }),
    ...(search ? { search } : {}),
  };
}
