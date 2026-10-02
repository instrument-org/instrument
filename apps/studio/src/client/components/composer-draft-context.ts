import { type PromptDraftKey } from "@/client/atoms/prompt-value";
import { createContext, useContext } from "react";

/**
 * The draft of the composer drawn under a transcript: where "Add to chat" on a
 * file named in that transcript puts the file. Absent where no composer is
 * drawn, as in a task's own transcript, so the action is not offered there.
 */
export const ComposerDraftContext = createContext<PromptDraftKey | undefined>(
  undefined,
);

export function useComposerDraft(): PromptDraftKey | undefined {
  return useContext(ComposerDraftContext);
}
