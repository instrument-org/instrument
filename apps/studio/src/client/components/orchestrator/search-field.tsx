import { Input } from "@/client/components/ui/input";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";

/**
 * The search as a field over the inbox, the way mail puts it: it narrows the
 * list as it is typed into, and an x or Escape empties it. Nothing here takes
 * focus on its own unless asked to.
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
  return (
    <div className="relative">
      <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Search threads"
        autoFocus={autoFocus}
        className="h-7 rounded-md pr-6 pl-7 text-xs"
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
        placeholder="Search"
        type="text"
        value={value}
      />
      {value !== "" && (
        <button
          aria-label="Clear search"
          className="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
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
