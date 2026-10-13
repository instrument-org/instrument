import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";

/**
 * An editor's last save failed: stays at the foot of the editor until a save
 * goes through, so a toast that has timed out is not the only sign that what
 * is on screen is not on disk. The next edit saves again too.
 */
export function SaveFailedPill({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover py-1 pr-1 pl-3 text-xs font-medium text-foreground shadow-md"
      role="alert"
    >
      <WarningCircleIcon className="size-3.5 shrink-0 text-destructive" />
      Your changes aren’t saved.
      <button
        className="rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground hover:bg-muted dark:bg-gray-800 dark:hover:bg-gray-700"
        onClick={onRetry}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}
