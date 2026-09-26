import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";

/**
 * The pill a live editor floats when the agent changed the file out of view:
 * which way the change lies, and a click that scrolls to it.
 */
export function UpdatedPill({
  direction,
  onClick,
}: {
  direction: "above" | "below";
  onClick: () => void;
}) {
  return (
    <button
      className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1.5 text-xs font-medium text-foreground shadow-md hover:bg-muted"
      onClick={onClick}
      type="button"
    >
      {direction === "below" ? (
        <ArrowDownIcon className="size-3.5" />
      ) : (
        <ArrowUpIcon className="size-3.5" />
      )}
      {direction === "below" ? "Updated below" : "Updated above"}
    </button>
  );
}
