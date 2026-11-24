import { type ChatId, ChatIdSchema } from "@instrument-org/workspace/electron";
import { z } from "zod";

/** The key the chats waiting for a window's sidebar are kept under, in `layout`. */
export const PHONE_CHATS_KEY = "phone-chats.v1";

/**
 * Gives a chat the person started from a phone a tab group on the computer
 * that sent it, so it is in the sidebar when they come back. The window last
 * in front is asked to list it (`listChat`), with nothing raised and the
 * group up unchanged. The chat is kept until that window says it did, so one
 * sent with every window closed, or just before a quit, is listed by the
 * next window to open. A window lists a chat once, however often it is asked.
 */
export function createPhoneChatGroups({
  ask,
  kept,
  keep,
}: {
  /** Asks a window to list a chat; answers which one it asked, by its web contents, or nothing while none hears. */
  ask: (chat: ChatId) => number | undefined;
  keep: (chats: ChatId[]) => void;
  /** The chats kept, as the file has them. */
  kept: () => unknown;
}) {
  /** The window each chat was asked of, which is not asked of another while it may still answer. */
  const asked = new Map<ChatId, number>();

  const waiting = () => z.array(ChatIdSchema).safeParse(kept()).data ?? [];

  const offer = () => {
    for (const chat of waiting()) {
      if (!asked.has(chat)) {
        const window = ask(chat);
        if (window !== undefined) {
          asked.set(chat, window);
        }
      }
    }
  };

  return {
    add: (chat: ChatId) => {
      keep([...waiting().filter((each) => each !== chat), chat]);
      offer();
    },
    /** A window's page is up: what waits is asked of the one in front. */
    offer,
    /** A window lists the chat, or has it in a group already. */
    listed: (chat: ChatId) => {
      asked.delete(chat);
      keep(waiting().filter((each) => each !== chat));
    },
    /** A window's page stopped hearing: what it did not answer is asked of another. */
    stopped: (window: number) => {
      for (const [chat, of] of asked) {
        if (of === window) {
          asked.delete(chat);
        }
      }
      offer();
    },
  };
}
