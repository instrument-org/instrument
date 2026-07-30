import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import {
  CaretDownIcon,
  CaretUpIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type RefObject } from "react";

/**
 * The app's find-in-something control: a query field, a match readout, and
 * previous/next/close. Shared by the browser panel's find bar and the document
 * viewers' find popover so the two read and behave identically; each host owns
 * where the row sits and what it searches.
 *
 * `activeMatch` is one-based to match how the count reads on screen. Hosts that
 * track a zero-based index add one rather than this offsetting for them, so the
 * two numbers in `2/7` always come from the same base.
 */
export function FindRow({
  activeMatch,
  className,
  inputRef,
  matchCount,
  onClose,
  onNextMatch,
  onPreviousMatch,
  onQueryChange,
  placeholder,
  query,
}: {
  activeMatch: number;
  className?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  matchCount: number;
  onClose: () => void;
  onNextMatch: () => void;
  onPreviousMatch: () => void;
  onQueryChange: (query: string) => void;
  placeholder: string;
  query: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <MagnifyingGlassIcon className="ml-1 size-4 shrink-0 text-muted-foreground" />
      <input
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) {
              onPreviousMatch();
            } else {
              onNextMatch();
            }
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder={placeholder}
        ref={inputRef}
        spellCheck={false}
        value={query}
      />
      <span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">
        {query === "" ? "" : `${matchCount === 0 ? 0 : activeMatch}/${matchCount}`}
      </span>
      <Button
        aria-label="Previous match"
        disabled={matchCount === 0}
        onClick={onPreviousMatch}
        size="icon-sm"
        variant="ghost"
      >
        <CaretUpIcon className="size-4" />
      </Button>
      <Button
        aria-label="Next match"
        disabled={matchCount === 0}
        onClick={onNextMatch}
        size="icon-sm"
        variant="ghost"
      >
        <CaretDownIcon className="size-4" />
      </Button>
      <Button
        aria-label="Close find"
        onClick={onClose}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}
