import { type Draft } from "@/client/atoms/orchestrator";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { useEffect } from "react";

import { type BrowserTabsHandle } from "./browser-tabs";
import { ComposeBar, ComposeWindow, type DraftSend } from "./compose-window";
import { type Topic } from "./threads";
import { type useCompose } from "./use-compose";

/**
 * The drafts being written, drawn over the row: each in its window at its
 * place along the foot, or as the bar it was put down to. Laid over the
 * whole row and letting the pointer through everywhere but the windows, so
 * the inbox and the thread stay in reach beside them.
 */
export function ComposeLayer({
  browser,
  compose,
  drafts,
  isStarting,
  modelURI,
  onChangeDraft,
  onCloseDraft,
  onModelChange,
  onStart,
  openOutside,
  topics,
}: {
  browser: BrowserTabsHandle | null;
  compose: ReturnType<typeof useCompose>;
  drafts: Draft[];
  /** The draft being started, while its first message is on its way. */
  isStarting: string | undefined;
  modelURI: AIGatewayModelURI.Type | undefined;
  onChangeDraft: (id: string, update: (draft: Draft) => Draft) => void;
  /** A window closed, with the words as its box had them: the draft is kept or thrown away by them. */
  onCloseDraft: (id: string, words: string) => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onStart: (id: string, send: DraftSend) => void;
  openOutside: (href: string) => void;
  topics: Topic[];
}) {
  // A window whose draft is gone (thrown away from the Drafts place, or a
  // record that did not survive) has nothing to write in.
  const orphans = compose.entries.filter(
    (entry) => !drafts.some((draft) => draft.id === entry.draftId),
  );
  const orphanKey = orphans.map((entry) => entry.draftId).join("\n");
  useEffect(() => {
    for (const id of orphanKey.split("\n").filter(Boolean)) {
      compose.remove(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orphanKey]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {compose.placed.map((entry) => {
        const draft = drafts.find(
          (candidate) => candidate.id === entry.draftId,
        );
        if (!draft) {
          return null;
        }
        if (entry.placement === "bar") {
          return (
            <div className="pointer-events-auto contents" key={draft.id}>
              <ComposeBar
                draft={draft}
                onClose={() => {
                  onCloseDraft(draft.id, draft.words);
                }}
                onOpen={() => {
                  compose.setPlacement(draft.id, "docked");
                }}
                right={entry.right}
              />
            </div>
          );
        }
        return (
          <div className="pointer-events-auto contents" key={draft.id}>
            <ComposeWindow
              browser={browser}
              draft={draft}
              isStarting={isStarting === draft.id}
              modelURI={modelURI}
              onChange={(update) => {
                onChangeDraft(draft.id, update);
              }}
              onClose={(words) => {
                onCloseDraft(draft.id, words);
              }}
              onModelChange={onModelChange}
              onPageHost={(element) => {
                compose.setHost(draft.id, element);
              }}
              onPlacementChange={(placement) => {
                compose.setPlacement(draft.id, placement);
              }}
              onStart={(send) => {
                onStart(draft.id, send);
              }}
              onViewChange={(view) => {
                compose.setView(draft.id, view);
              }}
              openOutside={openOutside}
              placement={entry.placement}
              right={entry.right}
              topics={topics}
            />
          </div>
        );
      })}
    </div>
  );
}
