import { type Draft, draftGroupOf } from "@/client/atoms/orchestrator";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type SessionMessageDataPart,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { AnimatePresence } from "motion/react";
import { useEffect } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";
import { ComposeBar, ComposeWindow, type DraftSend } from "./compose-window";
import { ThreadBar, ThreadWindow } from "./thread-window";
import { type Thread, type Topic } from "./threads";
import { type useCompose } from "./use-compose";

/**
 * The windows floating over the row: the drafts being written, each in its
 * window at its place along the foot or as the bar it was put down to, and
 * the threads in their small views beside them. Laid over the whole row and
 * letting the pointer through everywhere but the windows, so the inbox, the
 * thread and the places stay in reach beside them. A window or a bar
 * arrives and leaves with a motion of its own, so a draft opening is seen
 * to open; a draft becoming a thread keeps its window, since it is the same
 * window in the same corner.
 */
export function ComposeLayer({
  browser,
  childTitles,
  compose,
  drafts,
  isStarting,
  modelURI,
  onChangeDraft,
  onCloseDraft,
  onCloseThread,
  onExpandThread,
  onModelChange,
  onOpenApps,
  onPressThreadTab,
  onStart,
  openOutside,
  sendContext,
  threads,
  topics,
}: {
  browser: BrowserTabsHandle | null;
  childTitles: Map<TaskId, string>;
  compose: ReturnType<typeof useCompose>;
  drafts: Draft[];
  /** The draft being started, while its first message is on its way. */
  isStarting: string | undefined;
  modelURI: AIGatewayModelURI.Type | undefined;
  onChangeDraft: (id: string, update: (draft: Draft) => Draft) => void;
  /** A window closed, with the words as its box had them: the draft is kept or thrown away by them. */
  onCloseDraft: (id: string, words: string) => void;
  /** A thread's small view closed: the window goes, and the thread is as it was in Chat. */
  onCloseThread: (sessionId: StoreId.Session) => void;
  /** A thread's small view expanded: it lands in Chat, whole. */
  onExpandThread: (sessionId: StoreId.Session) => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  /** Takes the window to the Apps place, for a draft with no app to name yet. */
  onOpenApps: () => void;
  /** A tab pressed in a small view's picture: the thread lands in Chat with that tab in front. */
  onPressThreadTab: (sessionId: StoreId.Session, tabId: string) => void;
  onStart: (id: string, send: DraftSend) => void;
  openOutside: (href: string) => void;
  /** What the window has on screen as a reply is sent from a small view. */
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
  threads: Thread[];
  topics: Topic[];
}) {
  // A window whose draft is gone (thrown away from the Drafts place, or a
  // record that did not survive) has nothing to write in. A thread's window
  // is kept whatever the list says: the list is re-read behind the thread's
  // creation, and the window names the thread by its id.
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

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <AnimatePresence initial={false}>
        {compose.placed.map((entry) => {
          if (entry.kind === "thread") {
            const { sessionId } = entry;
            const thread = threads.find(
              (candidate) => candidate.id === sessionId,
            );
            if (entry.placement === "bar") {
              return (
                <ThreadBar
                  key={`bar:${sessionId}`}
                  onClose={() => {
                    onCloseThread(sessionId);
                  }}
                  onOpen={() => {
                    compose.setPlacement(sessionId, "docked");
                  }}
                  right={entry.right}
                  thread={thread}
                />
              );
            }
            return (
              <ThreadWindow
                arrives={entry.fromDraft === undefined}
                childTitles={childTitles}
                // The draft's key, for a thread that grew from one: the same
                // element, so the window is not seen to leave and arrive.
                key={entry.fromDraft ?? sessionId}
                onClose={() => {
                  onCloseThread(sessionId);
                }}
                onExpand={() => {
                  onExpandThread(sessionId);
                }}
                onMinimize={() => {
                  compose.setPlacement(sessionId, "bar");
                }}
                onPressTab={(tabId) => {
                  onPressThreadTab(sessionId, tabId);
                }}
                right={entry.right}
                sendContext={sendContext}
                sessionId={sessionId}
                thread={thread}
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
              isStarting={isStarting === draft.id}
              key={draft.id}
              modelURI={modelURI}
              onChange={(update) => {
                onChangeDraft(draft.id, update);
              }}
              onClose={(words) => {
                onCloseDraft(draft.id, words);
              }}
              onModelChange={onModelChange}
              onOpenApps={onOpenApps}
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
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
