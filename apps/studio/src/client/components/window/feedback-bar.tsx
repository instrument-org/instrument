import {
  type FeedbackDraft,
  openReportDialog,
} from "@/client/atoms/report-dialog";
import { discardFeedback } from "@/client/lib/problem-reports";
import { MegaphoneSimpleIcon } from "@phosphor-icons/react/MegaphoneSimple";

import { FootBar } from "./compose-window";

/**
 * Feedback put down: its bar at the right end of the window's foot, with
 * the note's first line, or the write-up's title before there is a note. A press brings the dialog back as it was left, and
 * its cross throws the draft away, with an Undo.
 */
export function FeedbackBar({
  draft,
  right,
}: {
  draft: FeedbackDraft;
  /** Where the bar stands along the foot, in layout px from the right edge. */
  right: number;
}) {
  return (
    <FootBar
      closeLabel="Discard feedback"
      icon={<MegaphoneSimpleIcon className="size-3.5 shrink-0" />}
      label={
        draft.note.trim().split("\n")[0] ||
        draft.writeups[0]?.title ||
        "Feedback"
      }
      onClose={() => {
        discardFeedback(draft);
      }}
      onOpen={() => {
        openReportDialog(draft.request);
      }}
      right={right}
    />
  );
}
