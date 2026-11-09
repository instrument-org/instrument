import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { readDelay } from "./read-on-view";
import { tabCarryViewAtom } from "./tab-carry-view";

/**
 * Marks the chat on screen read once it has really been looked at: up in its
 * tab, in a window on screen, for as long as `readDelay` asks. Hiding the
 * window pauses the wait and showing it starts it again. A window waiting beneath
 * a tab's drag is on screen under another, and has not been looked at.
 */
export function useReadOnView({
  chat,
  chatId,
  isUp: isTabUp,
}: {
  /** The chat's unread mark as the list has it; absent until the list has the chat. */
  chat: undefined | { unread: boolean; unreadByUser: boolean };
  chatId: ChatId;
  isUp: boolean;
}) {
  const { mutate: markRead } = useMutation(
    rpcClient.workspace.chats.read.mutationOptions(),
  );
  const isUnread = chat?.unread === true;
  const isUnreadByUser = chat?.unreadByUser === true;
  const isBeneath = useAtomValue(tabCarryViewAtom).kind === "beneath";
  const isUp = isTabUp && !isBeneath;
  // How it was on the previous look, which tells arriving at the chat from
  // sitting on it. Null until the first look, which counts as an arrival.
  const wasUp = useRef<boolean | null>(null);
  const previousChatId = useRef<null | string>(null);
  useEffect(() => {
    const delay = readDelay({
      chatId,
      isUnread,
      isUnreadByUser,
      isUp,
      previousChatId: previousChatId.current,
      wasUp: wasUp.current,
    });
    wasUp.current = isUp;
    previousChatId.current = chatId;
    if (delay === null) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => {
      clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState !== "visible") {
        return;
      }
      timer = setTimeout(() => {
        markRead({ id: chatId });
      }, delay);
    };
    wait();
    document.addEventListener("visibilitychange", wait);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wait);
    };
  }, [chatId, isUnread, isUnreadByUser, isUp, markRead]);
}
