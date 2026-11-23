import { ReplyNote, ReplyNoteButton } from "@/client/components/reply-note";
import { type ModelAction, type ModelNotice } from "@/client/lib/model-status";
import { ArrowCircleUpIcon } from "@phosphor-icons/react/ArrowCircleUp";
import { WarningIcon } from "@phosphor-icons/react/Warning";

/**
 * The note that says what is going on with the chosen model, docked over the
 * reply box like every other note there. An offer of a newer release is quiet
 * and can be set aside; a problem is the app's yellow and goes only when it is
 * fixed.
 *
 * Its first button does the thing (switches, retries) rather than opening something
 * that does, so the note that reports a problem is also the way out of it.
 *
 * `nudge` counts the sends it refused: each new count flashes the note, so a
 * blocked send points at the reason already on screen.
 */
export function ModelNoticeRow({
  className,
  notice,
  nudge = 0,
  onAction,
  onDismiss,
}: {
  className?: string;
  notice: ModelNotice;
  nudge?: number;
  onAction: (action: ModelAction) => void;
  onDismiss?: () => void;
}) {
  const isOffer = notice.tone === "offer";
  return (
    <ReplyNote
      action={
        <>
          {[notice.secondary, notice.action].map(
            (action) =>
              action && (
                <ReplyNoteButton
                  emphasis={
                    action === notice.action && notice.secondary !== undefined
                  }
                  key={action.label}
                  onClick={() => {
                    onAction(action);
                  }}
                >
                  {action.label}
                </ReplyNoteButton>
              ),
          )}
        </>
      }
      className={className}
      data-slot="model-notice"
      icon={isOffer ? ArrowCircleUpIcon : WarningIcon}
      iconClassName={isOffer ? "text-brand-700 dark:text-brand-300" : undefined}
      nudge={nudge}
      onDismiss={notice.dismissible ? onDismiss : undefined}
      title={notice.detail}
      tone={isOffer ? "neutral" : "warn"}
    >
      {notice.text}
    </ReplyNote>
  );
}
