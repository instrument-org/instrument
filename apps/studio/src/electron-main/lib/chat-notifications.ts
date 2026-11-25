import { type ChatId } from "@instrument-org/workspace/electron";

interface Shown {
  close: () => void;
  /** Read in a window that was on screen while another app had the keyboard. */
  isRead: boolean;
  /** Put up over the app itself, where the chat may be on screen already. */
  overApp: boolean;
}

/**
 * The notifications in the system's list, by the chat each is about, and
 * which of them go once their chat is read. A chat beside another app's
 * window is marked read without the person having come to it, so its
 * notification waits for the app to come forward. One put up while the app
 * was in front, which the person asked for in Settings, stays until they
 * answer it: its chat may be read in the same moment.
 */
export function createChatNotifications() {
  const shown = new Map<ChatId, Set<Shown>>();
  const closeRead = (chat: ChatId) => {
    for (const one of shown.get(chat) ?? []) {
      if (one.isRead && !one.overApp) {
        one.close();
        shown.get(chat)?.delete(one);
      }
    }
    if (shown.get(chat)?.size === 0) {
      shown.delete(chat);
    }
  };
  return {
    /** Adds a notification, and answers with what takes it back out. */
    add: (
      chat: ChatId,
      { close, overApp }: { close: () => void; overApp: boolean },
    ) => {
      const one: Shown = { close, isRead: false, overApp };
      const ofChat = shown.get(chat) ?? new Set();
      shown.set(chat, ofChat.add(one));
      return () => {
        ofChat.delete(one);
        if (ofChat.size === 0 && shown.get(chat) === ofChat) {
          shown.delete(chat);
        }
      };
    },
    appCameForward: () => {
      for (const chat of shown.keys()) {
        closeRead(chat);
      }
    },
    chatRead: (chat: ChatId, { inFront }: { inFront: boolean }) => {
      for (const one of shown.get(chat) ?? []) {
        one.isRead = true;
      }
      if (inFront) {
        closeRead(chat);
      }
    },
  };
}
