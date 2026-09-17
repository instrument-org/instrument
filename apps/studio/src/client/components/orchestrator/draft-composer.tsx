import { type Draft, draftSnapshotsAtom } from "@/client/atoms/orchestrator";
import { promptDraftAtom } from "@/client/atoms/prompt-value";
import { FileDropRegion } from "@/client/components/file-drop-region";
import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type FileUpload,
  type FolderAttachment,
} from "@instrument-org/workspace/client";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { useAtomValue, useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

import { OutputPicker } from "./output-picker";
import { useIdeas } from "./use-ideas";

/** What the composer hands over to start the thread. */
export interface DraftSend {
  files?: FileUpload.Input[];
  folders?: { access: FolderAttachment.Access; path: string }[];
  modelURI: AIGatewayModelURI.Type;
  /** The kind of page the response should come back as, when one was picked. */
  output?: { name: string; title: string };
  prompt: string;
}

/**
 * The conversation column while a draft is up: a head naming it, with the
 * pane toggle while the pane is closed, and centered under it the prompt
 * box the new-task page starts a task from, rounding, plus menu, model and
 * all, with the output picker in the row beside the model. A topic the
 * draft was started under rides along unseen; the thread's head is where
 * topics are given. The words
 * ride in the draft's record, so the Drafts list can name it and a relaunch
 * keeps them; what else the box was given (files, a folder) is kept in
 * memory while the draft is away and put back when it comes up.
 */
export function DraftComposer({
  draft,
  isStarting,
  modelURI,
  onChange,
  onModelChange,
  onStart,
  trailing,
}: {
  draft: Draft;
  isStarting: boolean;
  modelURI: AIGatewayModelURI.Type | undefined;
  onChange: (update: (draft: Draft) => Draft) => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onStart: (send: DraftSend) => void;
  /** What sits at the head's right: the pane toggle while the pane is closed. */
  trailing?: ReactNode;
}) {
  const key = { id: draft.id, scope: "transient" as const };
  const snapshots = useAtomValue(draftSnapshotsAtom);
  const setSnapshots = useSetAtom(draftSnapshotsAtom);
  const snapshot = snapshots[draft.id];
  // The words the box opens with: what was kept of it when it was put away,
  // or, after a relaunch, the record's own words. Seeded once, since the
  // box's draft is dropped with it and made afresh each time it mounts.
  useHydrateAtoms([[promptDraftAtom(key), snapshot ? "" : draft.words]]);
  const words = useAtomValue(promptDraftAtom(key));
  // A box seeded empty, with what was kept still to be put back into it, is
  // not the user clearing the words: the first reading is let go.
  const isRestoringRef = useRef(snapshot !== undefined);
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    if (words !== draft.words) {
      onChange((current) => ({ ...current, words }));
    }
    // The record follows the box; the box never follows the record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

  const inputRef = useRef<PromptInputRef>(null);
  // Layout rather than passive effects: on the way in the box's handle is
  // set by then and on the way out it is still there, which a passive
  // cleanup would find already gone.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (snapshot) {
      input?.restore(snapshot);
    }
    return () => {
      const kept = input?.snapshot();
      if (kept) {
        setSnapshots((current) => ({ ...current, [draft.id]: kept }));
      }
    };
    // Once per mount: the snapshot restored is the one from before it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  const ideas = useIdeas();
  const output = ideas.data?.find((idea) => idea.name === draft.output);

  return (
    <FileDropRegion className="flex h-full min-h-0 flex-col">
      <div className="flex w-full min-w-0 shrink-0 items-center gap-x-2 bg-background p-3">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-x-2 select-none">
          <PencilSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="min-w-0 truncate text-sm font-medium">New thread</h2>
        </div>
        {trailing && (
          <div className="flex shrink-0 items-center gap-x-1">{trailing}</div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 pb-4">
        <div className="mx-auto w-full max-w-2xl">
          <PromptInput
            autoFocus
            autoResizeMaxHeight={300}
            beforeModel={
              <OutputPicker
                disabled={isStarting}
                onChange={(name) => {
                  onChange((current) => {
                    const { output: _dropped, ...rest } = current;
                    return name === undefined
                      ? rest
                      : { ...rest, output: name };
                  });
                }}
                value={draft.output}
              />
            }
            draftKey={key}
            isLoading={isStarting}
            modelURI={modelURI}
            onModelChange={onModelChange}
            onSubmit={(send) => {
              onStart({
                ...send,
                ...(output
                  ? { output: { name: output.name, title: output.title } }
                  : {}),
              });
            }}
            placeholder="What do you need?"
            ref={inputRef}
          />
        </div>
      </div>
    </FileDropRegion>
  );
}
