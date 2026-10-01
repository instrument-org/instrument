import { composeKeyOf, type Draft, draftGroupOf } from "@/client/atoms/window";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";
import { ChatBar, ChatWindow } from "./chat-window";
import { type Chat, type Topic } from "./chats";
import { COMPOSE_MOTION } from "./compose-layout";
import { ComposeBar, ComposeWindow, type DraftSend } from "./compose-window";
import { type useCompose } from "./use-compose";

/**
 * The windows floating over the row: the drafts being written, each in its
 * window at its place along the foot or as the bar it was put down to, and
 * the chats in their small views beside them. Laid over the whole row and
 * letting the pointer through everywhere but the windows, so the inbox, the
 * chat and the places stay in reach beside them. A window or a bar
 * arrives and leaves with a motion of its own, so a draft opening is seen
 * to open; a draft becoming a chat keeps its window, since it is the same
 * window in the same corner. A grown window stands over a scrim that holds
 * the rest of the window still, like a dialog: pressing the scrim or Escape
 * shrinks it back to the foot.
 */
export function ComposeLayer({
  browser,
  chats,
  compose,
  drafts,
  modelURI,
  onChangeDraft,
  onCloseChat,
  onCloseDraft,
  onCloseTab,
  onModelChange,
  onNewChatTopic,
  onNewTopic,
  onOpenChat,
  onPressChatTab,
  onSetChatTopics,
  onStart,
  openOutside,
  sendContext,
  sentWords,
  topics,
}: {
  browser: BrowserTabsHandle | null;
  chats: Chat[];
  compose: ReturnType<typeof useCompose>;
  drafts: Draft[];
  modelURI: AIGatewayModelURI.Type | undefined;
  onChangeDraft: (id: string, update: (draft: Draft) => Draft) => void;
  /** A chat's small view closed: the window goes, and the chat is as it was in Chat. */
  onCloseChat: (sessionId: StoreId.Session) => void;
  /** A window closed, with the words as its box had them: the draft is kept or thrown away by them. */
  onCloseDraft: (id: string, words: string) => void;
  /** A tab closed from a chat window's rail: asks first while a task is working in it. */
  onCloseTab: (id: string) => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  /** A topic asked for from a draft's head, with what was typed: the topic it makes files that draft. */
  /** Makes a topic from a popped-out chat's head, filing that chat under it. */
  onNewChatTopic: (sessionId: StoreId.Session, name?: string) => void;
  onNewTopic: (draftId: string, name: string) => void;
  /** A popped-out chat asked to open in Chats, from its title: the window goes and the chat is selected. */
  onOpenChat: (sessionId: StoreId.Session) => void;
  /** A thing a grown window cannot draw, asked for: the chat lands in Chats with that tab in front. */
  onPressChatTab: (sessionId: StoreId.Session, tabId: string) => void;
  onSetChatTopics: (sessionId: StoreId.Session, topics: string[]) => void;
  onStart: (id: string, send: DraftSend) => void;
  openOutside: (href: string) => void;
  /** What goes with a reply sent from a chat's small view: its own tab up while its view is open, what the window has up behind it otherwise. */
  sendContext: (options: {
    isViewOpen: boolean;
    sessionId: StoreId.Session;
  }) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  /** What each chat being started from a draft sent, by the chat: its window shows the words until its transcript has them. */
  sentWords: ReadonlyMap<StoreId.Session, string>;
  topics: Topic[];
}) {
  // A window whose draft is gone (thrown away from the Drafts place, or a
  // record that did not survive) has nothing to write in. A chat's window
  // is kept whatever the list says: the list is re-read behind the chat's
  // creation, and the window names the chat by its id.
  const orphanKey = compose.entries
    .flatMap((entry) =>
      entry.kind === "draft" &&
      !drafts.some((draft) => draft.id === entry.draftId)
        ? [draftGroupOf(entry.draftId)]
        : [],
    )
    .join("\n");
  useEffect(() => {
    for (const key of orphanKey.split("\n").filter(Boolean)) {
      compose.remove(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orphanKey]);

  const grown = compose.placed.find((entry) => entry.placement === "expanded");
  const shrink = () => {
    if (grown) {
      compose.setPlacement(composeKeyOf(grown), "docked");
    }
  };

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40"
      // Bubbled from inside the windows, so a menu or a picker that took its
      // own Escape (and marked it handled) is closed first. The prompt editor
      // marks every Escape handled whether it did anything or not, and stops
      // the one that closed its menu, so one that arrives from it is free.
      onKeyDown={(event) => {
        if (
          grown &&
          event.key === "Escape" &&
          (!event.defaultPrevented ||
            (event.target instanceof Element &&
              event.target.closest(".ProseMirror") !== null))
        ) {
          event.preventDefault();
          shrink();
        }
      }}
    >
      <AnimatePresence initial={false}>
        {/* Over the bars along the foot and under the grown window, which is
          drawn after it on the same layer. */}
        {grown && (
          <motion.div
            animate={{ opacity: 1 }}
            className="pointer-events-auto absolute inset-0 z-41 bg-black/20 dark:bg-black/50"
            data-slot="compose-scrim"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="scrim"
            onClick={shrink}
            transition={COMPOSE_MOTION}
          />
        )}
        {compose.placed.map((entry) => {
          if (entry.kind === "chat") {
            const { sessionId } = entry;
            const chat = chats.find((candidate) => candidate.id === sessionId);
            if (entry.placement === "bar") {
              return (
                <ChatBar
                  chat={chat}
                  key={`bar:${sessionId}`}
                  onClose={() => {
                    onCloseChat(sessionId);
                  }}
                  onOpen={() => {
                    compose.setPlacement(sessionId, "docked");
                  }}
                  right={entry.right}
                />
              );
            }
            return (
              <ChatWindow
                arrives={entry.fromDraft === undefined}
                chat={chat}
                isRailCompact={entry.isRailCompact === true}
                // The draft's key, for a chat that grew from one: the same
                // element, so the window is not seen to leave and arrive.
                key={entry.fromDraft ?? sessionId}
                onClose={() => {
                  onCloseChat(sessionId);
                }}
                onCloseTab={onCloseTab}
                onLandOnTab={(tabId) => {
                  onPressChatTab(sessionId, tabId);
                }}
                onMinimize={() => {
                  compose.setPlacement(sessionId, "bar");
                }}
                onNewTopic={(name) => {
                  onNewChatTopic(sessionId, name);
                }}
                onOpenInChats={() => {
                  onOpenChat(sessionId);
                }}
                onPageChrome={(slots) => {
                  compose.setChrome(sessionId, slots);
                }}
                onPageHost={(element) => {
                  compose.setHost(sessionId, element);
                }}
                onPlacementChange={(placement) => {
                  compose.setPlacement(sessionId, placement);
                }}
                onSetTopics={(next) => {
                  onSetChatTopics(sessionId, next);
                }}
                placement={entry.placement}
                right={entry.right}
                sendContext={(options) =>
                  sendContext({ ...options, sessionId })
                }
                sentWords={sentWords.get(sessionId)}
                sessionId={sessionId}
                topics={topics}
                width={entry.width}
              />
            );
          }
          const draft = drafts.find(
            (candidate) => candidate.id === entry.draftId,
          );
          if (!draft) {
            return null;
          }
          const key = draftGroupOf(draft.id);
          if (entry.placement === "bar") {
            return (
              <ComposeBar
                draft={draft}
                key={`bar:${draft.id}`}
                onClose={() => {
                  onCloseDraft(draft.id, draft.words);
                }}
                onOpen={() => {
                  compose.setPlacement(key, "docked");
                }}
                right={entry.right}
              />
            );
          }
          return (
            <ComposeWindow
              browser={browser}
              draft={draft}
              key={draft.id}
              modelURI={modelURI}
              onChange={(update) => {
                onChangeDraft(draft.id, update);
              }}
              onClose={(words) => {
                onCloseDraft(draft.id, words);
              }}
              onModelChange={onModelChange}
              onNewTopic={(name) => {
                onNewTopic(draft.id, name);
              }}
              onPageChrome={(slots) => {
                compose.setChrome(key, slots);
              }}
              onPageHost={(element) => {
                compose.setHost(key, element);
              }}
              onPlacementChange={(placement) => {
                compose.setPlacement(key, placement);
              }}
              onStart={(send) => {
                onStart(draft.id, send);
              }}
              onViewChange={(view) => {
                compose.setView(key, view);
              }}
              openOutside={openOutside}
              placement={entry.placement}
              right={entry.right}
              topics={topics}
              width={entry.width}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
