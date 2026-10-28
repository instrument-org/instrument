import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";
import { type Ref } from "react";

/**
 * The search as a field beside the view picker, the way mail puts it: it
 * narrows the list as it is typed into, and an x or Escape empties it. A
 * field with its glass at the left and the view it reads named in its
 * placeholder. Nothing here takes focus on its own.
 */
export function SearchField({
  inputRef,
  onChange,
  onFocusChange,
  placeholder,
  value,
}: {
  inputRef?: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  /** Told when the field takes focus and when it lets it go. */
  onFocusChange?: (isFocused: boolean) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Search chats"
        className={cn(
          // Room at the end for the clear button only while there is
          // something to clear; a long placeholder or search runs to the
          // field's inset and ends in an ellipsis.
          "h-9 rounded-lg pl-8 text-sm text-ellipsis md:text-sm",
          value === "" ? "pr-3" : "pr-7",
          // A faint well at rest that darkens a touch under the pointer,
          // and the raised white field once it is typed into.
          "bg-foreground/4 bg-none shadow-none hover:bg-foreground/6 focus:bg-linear-to-b focus:shadow-sm",
          "dark:border-transparent dark:bg-foreground/4 dark:hover:bg-foreground/6 dark:focus:border-input dark:focus:bg-input/30 dark:focus:bg-none",
        )}
        onBlur={() => {
          onFocusChange?.(false);
        }}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onFocus={() => {
          onFocusChange?.(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        ref={inputRef}
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
