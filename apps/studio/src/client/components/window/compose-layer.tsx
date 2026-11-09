import { type Draft, draftGroupOf } from "@/shared/drafts";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type SessionMessageDataPart,
  type ChatId,
} from "@instrument-org/workspace/client";
import { AnimatePresence } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";
import { chatListOptions } from "./chat-list-query";
import { ChatBar, ChatWindow } from "./chat-window";
import { type Project } from "./chats";
import { ComposeBar, ComposeWindow, type DraftSend } from "./compose-window";
import { type ContextItem } from "./context-items";
import { type useCompose } from "./use-compose";

/**
 * The windows floating over the row: the drafts being written, each in its
 * window at its place along the foot, and the chats in their small views
 * beside them, or the bars they were put down to. Laid over the whole row and
 * letting the pointer through everywhere but the windows, so the inbox, the
 * chat and the places stay in reach beside them. A window or a bar arrives
 * and leaves with a motion of its own, so a draft opening is seen to open; a
 * draft becoming a chat keeps its window, since it is the same window in the
 * same corner.
 */
export function ComposeLayer({
  browser,
  compose,
  drafts,
  modelURI,
  onChangeDraft,
  onCloseChat,
  onCloseDraft,
  onDiscardDraft,
  onExpandChat,
  onExpandDraft,
  onModelChange,
  onNewChatProject,
  onNewProject,
  onSetChatProject,
  onStart,
  sendContext,
  sentWords,
  projects,
}: {
  browser: BrowserTabsHandle | null;
  compose: ReturnType<typeof useCompose>;
  drafts: Draft[];
  modelURI: AIGatewayModelURI.Type | undefined;
  onChangeDraft: (id: string, update: (draft: Draft) => Draft) => void;
  /** A chat's small view closed: the window goes, and the chat is as it was in Chat. */
  onCloseChat: (chatId: ChatId) => void;
  /** A window closed, with the words as its box had them and whether it was dictating more: the draft is kept or thrown away by them. */
  onCloseDraft: (id: string, words: string, dictating?: boolean) => void;
  /** A draft thrown away from its window's head. */
  onDiscardDraft: (id: string) => void;
  /** A popped-out chat expanded: the window goes and the chat comes up in a tab of the window's own, its pane open when asked. */
  onExpandChat: (chatId: ChatId, options: { showsPane: boolean }) => void;
  /** A draft's window expanded: the window goes and the draft comes up in the Chat screen, written there in full. */
  onExpandDraft: (id: string) => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  /** A project asked for from a draft's head, with what was typed: the project it makes files that draft. */
  /** Makes a project from a popped-out chat's head, filing that chat under it. */
  onNewChatProject: (chatId: ChatId, name?: string) => void;
  onNewProject: (draftId: string, name: string) => void;
  onSetChatProject: (chatId: ChatId, project: null | string) => void;
  onStart: (id: string, send: DraftSend) => void;
  /** What goes with a reply sent from a chat's small view: what the person took from what the window has behind it. */
  sendContext: (options: {
    chatId: ChatId;
    isViewOpen: boolean;
    taken: readonly ContextItem[];
  }) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  /** What each chat being started from a draft sent, by the chat: its window shows the words until its transcript has them. */
  sentWords: ReadonlyMap<ChatId, string>;
  projects: Project[];
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
  const removeOrphans = useEffectEvent(() => {
    for (const key of orphanKey.split("\n").filter(Boolean)) {
      compose.remove(key);
    }
  });
  useEffect(() => {
    removeOrphans();
  }, [orphanKey]);

  // The rows of the chats placed here, so another chat moving draws nothing.
  const placedIds = compose.placed.flatMap((entry) =>
    entry.kind === "chat" ? [entry.chatId] : [],
  );
  const { data: chats = [] } = useQuery({
    ...chatListOptions(),
    select: (listed) => listed.filter((chat) => placedIds.includes(chat.id)),
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <AnimatePresence initial={false}>
        {compose.placed.map((entry) => {
          if (entry.kind === "chat") {
            const { chatId } = entry;
            const chat = chats.find((candidate) => candidate.id === chatId);
            if (entry.placement === "bar") {
              return (
                <ChatBar
                  chat={chat}
                  key={`bar:${chatId}`}
                  onClose={() => {
                    onCloseChat(chatId);
                  }}
                  onOpen={() => {
                    compose.setPlacement(chatId, "docked");
                  }}
                  right={entry.right}
                />
              );
            }
            return (
              <ChatWindow
                arrives={entry.fromDraft === undefined}
                chat={chat}
                // The draft's key, for a chat that grew from one: the same
                // element, so the window is not seen to leave and arrive.
                key={entry.fromDraft ?? chatId}
                onClose={() => {
                  onCloseChat(chatId);
                }}
                onExpand={(options) => {
                  onExpandChat(chatId, options);
                }}
                onMinimize={() => {
                  compose.setPlacement(chatId, "bar");
                }}
                onNewProject={(name) => {
                  onNewChatProject(chatId, name);
                }}
                onSetProject={(next) => {
                  onSetChatProject(chatId, next);
                }}
                right={entry.right}
                sendContext={(options) => sendContext({ ...options, chatId })}
                sentWords={sentWords.get(chatId)}
                chatId={chatId}
                projects={projects}
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
              onClose={(words, dictating) => {
                onCloseDraft(draft.id, words, dictating);
              }}
              onDiscard={() => {
                onDiscardDraft(draft.id);
              }}
              onExpand={() => {
                onExpandDraft(draft.id);
              }}
              onMinimize={() => {
                compose.setPlacement(key, "bar");
              }}
              onModelChange={onModelChange}
              onNewProject={(name) => {
                onNewProject(draft.id, name);
              }}
              onStart={(send) => {
                onStart(draft.id, send);
              }}
              right={entry.right}
              projects={projects}
              width={entry.width}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
