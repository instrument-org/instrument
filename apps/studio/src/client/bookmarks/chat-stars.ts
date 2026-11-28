import { chatListOptions } from "@/client/components/window/chat-list-query";
import { rpcClient } from "@/client/rpc/client";
import {
  type BookmarkOp,
  orderAfter,
  OTHER_ROOT,
  siblingsIn,
} from "@/shared/bookmarks";
import { chatAddressOf } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";

import {
  applyBookmarkOpsAtom,
  bookmarkedChatsAtom,
  bookmarksLoadedAtom,
  bookmarksStateAtom,
} from "./store";

/** The chats this window has sent on to be bookmarked, so a list read again before their stars come off sends none twice. */
const moved = new Set<ChatId>();

/**
 * A chat starred by a build that kept stars apart from bookmarks, kept as a
 * bookmark at the end of All Bookmarks, and its star taken off so it is
 * moved once. Its bookmark's id is drawn from the chat's, so two windows or
 * two devices moving the same star write one bookmark.
 */
export function useMoveChatStarsToBookmarks() {
  const store = useStore();
  const isLoaded = useAtomValue(bookmarksLoadedAtom);
  const { data: chats } = useQuery(chatListOptions());
  useEffect(() => {
    const starred = (chats ?? []).filter(
      (chat) => chat.starred && !moved.has(chat.id),
    );
    if (!isLoaded || starred.length === 0) {
      return;
    }
    const state = store.get(bookmarksStateAtom);
    const bookmarked = store.get(bookmarkedChatsAtom);
    const first = orderAfter(siblingsIn(state, undefined, OTHER_ROOT));
    const ops: BookmarkOp[] = starred
      .filter((chat) => !bookmarked.has(chat.id))
      .map((chat, index) => ({
        bookmark: {
          id: `chat-${chat.id}`,
          order: first + index,
          root: OTHER_ROOT,
          title: chat.title,
          url: chatAddressOf(chat.id),
        },
        type: "add",
      }));
    for (const chat of starred) {
      moved.add(chat.id);
    }
    const move = async () => {
      if (ops.length > 0) {
        await store.set(applyBookmarkOpsAtom, ops);
      }
      await Promise.all(
        starred.map((chat) =>
          rpcClient.workspace.chats.star.call({ id: chat.id, starred: false }),
        ),
      );
    };
    // Tried again on the next list read when either step fails.
    move().catch(() => {
      for (const chat of starred) {
        moved.delete(chat.id);
      }
    });
  }, [chats, isLoaded, store]);
}
