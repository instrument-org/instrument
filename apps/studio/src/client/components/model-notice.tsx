import { type ModelAction, type ModelNotice } from "@/client/lib/model-status";
import { cn } from "@/client/lib/utils";
import { ArrowCircleUpIcon } from "@phosphor-icons/react/ArrowCircleUp";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { XIcon } from "@phosphor-icons/react/X";

/**
 * The one row that says what is going on with the chosen model, wherever it
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
  const Icon = isOffer ? ArrowCircleUpIcon : WarningIcon;
  return (
    <div
      className={cn(
        "flex min-h-8 min-w-0 items-center gap-2 rounded-lg py-1 pr-1 pl-2.5 text-xs",
        isOffer
          ? "bg-black/[0.04] text-foreground dark:bg-white/[0.06]"
          : "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-300 ring-inset dark:bg-yellow-500/15 dark:text-yellow-100 dark:ring-yellow-500/30",
        className,
      )}
      data-slot="model-notice"
      role={isOffer ? "status" : "alert"}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          isOffer
            ? "text-brand-700 dark:text-brand-300"
            : "text-yellow-700 dark:text-yellow-300",
        )}
      />
      <span className="min-w-0 flex-1 truncate" title={notice.detail}>
        {notice.text}
      </span>
      {notice.action && (
        <button
          className="h-6 shrink-0 rounded-md bg-white px-2 font-medium text-foreground shadow-xs ring-1 ring-black/10 hover:bg-gray-50 dark:bg-gray-700 dark:ring-white/10 dark:hover:bg-gray-600"
          onClick={() => {
            if (notice.action) {
              onAction(notice.action);
            }
          }}
          type="button"
        >
          {notice.action.label}
        </button>
      )}
      {notice.dismissible && onDismiss && (
        <button
          aria-label="Dismiss"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          onClick={onDismiss}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
