import { type ModelAction, type ModelNotice } from "@/client/lib/model-status";
import { ArrowCircleUpIcon } from "@phosphor-icons/react/ArrowCircleUp";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { ReplyNote, ReplyNoteButton } from "@/client/components/reply-note";

/**
 * The one note that says what is going on with the chosen model, wherever it
 * shows: over the words in the reply box and the draft, and over the picker's
 * list. An offer of a newer release is quiet and can be set aside; a problem
 * is the app's yellow and goes only when it is fixed.
 *
 * Its button does the thing (switches, retries) rather than opening something
 * that does, so the row that reports a problem is also the way out of it.
 */
export function ModelNoticeRow({
  className,
  notice,
  onAction,
  onDismiss,
}: {
  className?: string;
  notice: ModelNotice;
  onAction: (action: ModelAction) => void;
  onDismiss?: () => void;
}) {
  const isOffer = notice.tone === "offer";
  return (
    <ReplyNote
      action={
        notice.action && (
          <ReplyNoteButton
            onClick={() => {
              if (notice.action) {
                onAction(notice.action);
              }
            }}
          >
            {notice.action.label}
          </ReplyNoteButton>
        )
      }
      className={className}
      data-model-notice={notice.tone}
      icon={isOffer ? ArrowCircleUpIcon : WarningIcon}
      iconClassName={isOffer ? "text-brand-700 dark:text-brand-300" : undefined}
      onDismiss={notice.dismissible ? onDismiss : undefined}
      title={notice.detail}
      tone={isOffer ? "neutral" : "warn"}
    >
      {notice.text}
    </ReplyNote>
  );
}
