import { type ChatId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { useState } from "react";

import { chatContextItems, type ContextItem } from "./context-items";
import { tabSurfaceAtom } from "./tab-surface";
import { useTabInView } from "./use-tab-in-view";
import { useWindowTabs } from "./window-tabs";

/**
 * What a chat's composer carries besides its words, as the chips it draws
 * (see chatContextItems), and the keys of the ones the person left out, which
 * the send reads the same list with. A chip left out stays out until what it
 * named is no longer there, since a new thing comes with a new key.
 */
export function useChatContext({
  chatId,
  isViewOpen,
}: {
  chatId: ChatId;
  /** Whether the chat's view of its tab up is open where the message is written. */
  isViewOpen: boolean;
}): {
  items: ContextItem[];
  leaveOut: (item: ContextItem) => void;
  leftOut: readonly string[];
} {
  const windowTabs = useWindowTabs();
  const inView = useTabInView();
  const surfaces = useAtomValue(tabSurfaceAtom);
  const [leftOut, setLeftOut] = useState<readonly string[]>([]);
  const items = chatContextItems({
    chatId,
    finderOf: (id) => surfaces[id]?.finder ?? null,
    inView: isViewOpen ? undefined : inView,
    leftOut,
    up: isViewOpen ? windowTabs.selectedTabIn(chatId) : undefined,
  });
  return {
    items,
    leaveOut: (item) => {
      setLeftOut((current) => [...current, item.key]);
    },
    leftOut,
  };
}
