import { type StoreId } from "@instrument-org/workspace/client";
import { createContext, useContext, useState } from "react";

/**
 * Which steps in the transcript are open, held by the transcript rather than by
 * the rows themselves.
 *
 * A step inside a group is drawn in two different places over its life: as the
 * copy in the group's own slot while the group is folded, and in its place in
 * the run once the group is open. Those are different elements in different
 * parts of the tree, so a row holding its own state loses it at exactly the
 * moment the reader asked to keep it -- opening a step opens the group around
 * it, and that is what moves the step from the one place to the other.
 */
export interface TranscriptExpansion {
  isRowExpanded: (rowId: StoreId.Part) => boolean;
  setRowExpanded: (rowId: StoreId.Part, isExpanded: boolean) => void;
}

/**
 * Null outside a transcript, which is how a row knows to keep its own state:
 * nothing is folding it away, so it has nothing to survive.
 */
export const TranscriptExpansionContext =
  createContext<null | TranscriptExpansion>(null);

/** Whether this step is open, and how to open it; see `TranscriptExpansion`. */
export function useRowExpansion(rowId: StoreId.Part | undefined) {
  const transcript = useContext(TranscriptExpansionContext);
  const [isExpandedAlone, setIsExpandedAlone] = useState(false);

  if (transcript === null || rowId === undefined) {
    return { isExpanded: isExpandedAlone, setIsExpanded: setIsExpandedAlone };
  }
  return {
    isExpanded: transcript.isRowExpanded(rowId),
    setIsExpanded: (isExpanded: boolean) => {
      transcript.setRowExpanded(rowId, isExpanded);
    },
  };
}
