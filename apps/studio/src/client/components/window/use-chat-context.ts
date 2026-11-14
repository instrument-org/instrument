import { transcriptFeedOptions } from "@/client/components/transcript/use-transcript-feed";
import {
  type ChatId,
  type SessionMessageDataPart,
  type TranscriptFeed,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtomValue, useSetAtom } from "jotai";

import { chatListOptions } from "./chat-list-query";
import {
  chatContextItems,
  chatSuggestionOf,
  type ContextItem,
} from "./context-items";
import { tabSurfaceAtom } from "./tab-surface";
import { useTabInView } from "./use-tab-in-view";
import { useWindowTabs } from "./window-tabs";

const NOTHING_TAKEN: readonly ContextItem[] = [];

/**
 * What the person took for each chat's next message, by the chat: in the
 * window's memory, so it outlasts the chat's small view being put down to its
 * bar and brought back, and goes when the message does.
 */
const takenForNextMessageAtom = atom<Record<string, readonly ContextItem[]>>(
  {},
);

/**
 * What this window sent with each chat's messages, by the chat, so it is not
 * offered again in the moment before the message is in the transcript.
 */
const sentFromHereAtom = atom<Record<string, readonly ContextItem[]>>({});

const NOTHING_SENT: readonly SessionMessageDataPart.SentChip[] = [];

/** The chips the messages of a transcript went with, as far as it is read. */
function sentChipsOf(feed: TranscriptFeed): SessionMessageDataPart.SentChip[] {
  return feed.messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "data-viewContext" ? (part.data.attached ?? []) : [],
    ),
  );
}

/**
 * What a chat's next message carries besides its words (see
 * chatContextItems), the chips it draws for them, and what is offered beside
 * them. The chat's own tab goes without a chip: it is on screen beside the
 * conversation, often the page the agent was just working in, so a chip
 * would only say again what is in view. What stands behind a chat popped out
 * over another screen is offered, never carried, until the person takes it,
 * and never once one of the chat's messages went with it; what was taken goes
 * with the next message only, and the row is empty again once it has gone
 * (`sent`).
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
  /** Marks the message as gone, emptying what was taken for it. */
  sent: () => void;
  suggestion: ContextItem | undefined;
  take: (item: ContextItem) => void;
  taken: readonly ContextItem[];
} {
  const windowTabs = useWindowTabs();
  const inView = useTabInView();
  const surfaces = useAtomValue(tabSurfaceAtom);
  const finderOf = (id: string) => surfaces[id]?.finder ?? null;
  const takenByChat = useAtomValue(takenForNextMessageAtom);
  const setTakenByChat = useSetAtom(takenForNextMessageAtom);
  const taken = takenByChat[chatId] ?? NOTHING_TAKEN;
  const sentFromHere = useAtomValue(sentFromHereAtom)[chatId] ?? NOTHING_TAKEN;
  const setSentFromHere = useSetAtom(sentFromHereAtom);
  const isOffering = isPoppedOut && !isViewOpen;
  // The chat's own session, whose transcript the chat's view is reading too.
  const { data: sessionId } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((chat) => chat.id === chatId)?.sessionId,
  });
  const { data: sent = NOTHING_SENT } = useQuery({
    ...transcriptFeedOptions(
      isOffering && sessionId ? { id: chatId, sessionId } : undefined,
    ),
    select: sentChipsOf,
  });
  const setTaken = (
    update: (current: readonly ContextItem[]) => readonly ContextItem[],
  ) => {
    setTakenByChat((current) => ({
      ...current,
      [chatId]: update(current[chatId] ?? NOTHING_TAKEN),
    }));
  };
  const items = chatContextItems({
    chatId,
    finderOf,
    taken,
    up: isViewOpen ? windowTabs.selectedTabIn(chatId) : undefined,
  });
  return {
    chips: items.filter((item) => !(item.kind === "tab" && item.owned)),
    leaveOut: (item) => {
      setTaken((current) => current.filter((entry) => entry.key !== item.key));
    },
    sent: () => {
      setSentFromHere((current) => ({
        ...current,
        [chatId]: [...(current[chatId] ?? NOTHING_TAKEN), ...taken],
      }));
      setTaken(() => NOTHING_TAKEN);
    },
    suggestion: chatSuggestionOf({
      chatId,
      finderOf,
      inView: isOffering ? inView : undefined,
      sent,
      taken: [...taken, ...sentFromHere],
    }),
    take: (item) => {
      setTaken((current) => [...current, item]);
    },
    taken,
  };
}
