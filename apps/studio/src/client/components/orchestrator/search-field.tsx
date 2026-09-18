import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";

/**
 * The search as a field over the inbox, the way mail puts it: it narrows the
 * list as it is typed into, and an x or Escape empties it. A pill, with its
 * glass and its word centered while it holds nothing, the way a search box
 * rests; the words typed into it start at the left, behind the glass.
 * Nothing here takes focus on its own unless asked to.
 */
export function SearchField({
  autoFocus = false,
  onChange,
  value,
}: {
  autoFocus?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const isEmpty = value === "";
  return (
    <div className="relative">
      {isEmpty ? (
        // The resting face, over the field and out of the pointer's way: the
        // field's own placeholder cannot carry the glass beside the word.
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <MagnifyingGlassIcon className="size-3.5" />
          Search
        </span>
      ) : (
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      )}
      <Input
        aria-label="Search threads"
        autoFocus={autoFocus}
        className={cn(
          "h-7 rounded-full pr-6 pl-8 text-xs",
          // Centered while empty, so the caret waits beside the word.
          isEmpty && "text-center",
        )}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }
        }}
        type="text"
        value={value}
      />
      {value !== "" && (
        <button
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => {
            onChange("");
          }}
          type="button"
        >
          <XIcon className="size-2.5" weight="bold" />
        </button>
      )}
    </div>
  );
}
