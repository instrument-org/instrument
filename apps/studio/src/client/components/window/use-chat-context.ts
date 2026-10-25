import { type ChatId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { useState } from "react";

import { chatContextItems, type ContextItem } from "./context-items";
import { tabSurfaceAtom } from "./tab-surface";
import { useTabInView } from "./use-tab-in-view";
import { useWindowTabs } from "./window-tabs";

/**
 * What a chat's composer carries besides its words (see chatContextItems),
 * the chips it draws for them, and the keys of the ones the person left out,
 * which the send reads the same list with. The chat's own tab goes without a
 * chip: it is on screen beside the conversation, often the page the agent
 * was just working in, so a chip would only say again what is in view. What
 * stands behind a chat popped out over another screen gets one, since that
 * is something else, unless it is another chat; a chat in the tab's place
 * has nothing behind it. A chip left out stays out until what it named is
 * no longer there, since a new thing comes with a new key.
 */
export function useChatContext({
  chatId,
  isPoppedOut,
  isViewOpen,
}: {
  chatId: ChatId;
  /** Whether the chat is in a window of its own over another screen, rather than in the tab's place. */
  isPoppedOut: boolean;
  /** Whether the chat's view of its tab up is open where the message is written. */
  isViewOpen: boolean;
}): {
  chips: ContextItem[];
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
    inView: isPoppedOut && !isViewOpen ? inView : undefined,
    leftOut,
    up: isViewOpen ? windowTabs.selectedTabIn(chatId) : undefined,
  });
  return {
    chips: items.filter((item) => !(item.kind === "tab" && item.owned)),
    leaveOut: (item) => {
      setLeftOut((current) => [...current, item.key]);
    },
    leftOut,
  };
}
