import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";
import { type ReactNode, type Ref, useState } from "react";

/** A mark the search can narrow by, as it is offered and as its token reads. */
export interface SearchToken<T extends string> {
  icon: ReactNode;
  id: T;
  label: string;
}

/**
 * The search as a field beside the view button, the way mail puts it: it
 * narrows the list as it is typed into, and an x or Escape empties it. A
 * field with its glass at the left and the view it reads named in its
 * placeholder. Nothing here takes focus on its own.
 *
 * Given tokens, clicking into the empty field offers them under it, the way
 * Files offers a folder's kinds: a pick stands in the field ahead of the
 * words, its x or a Backspace at the field's start takes it away, and the
 * words typed after it search within it. Arrows and Return pick from the
 * offer while the keyboard stays in the field.
 */
export function SearchField<T extends string>({
  inputRef,
  offered = [],
  onChange,
  onFocusChange,
  onTokensChange,
  placeholder,
  tokens = [],
  value,
}: {
  inputRef?: Ref<HTMLInputElement>;
  /** The tokens there are any of in this view, offered under the field while it is empty. */
  offered?: SearchToken<T>[];
  onChange: (value: string) => void;
  /** Told when the field takes focus and when it lets it go. */
  onFocusChange?: (isFocused: boolean) => void;
  onTokensChange?: (tokens: T[]) => void;
  placeholder: string;
  /** The tokens standing in the field, in the order they were picked. */
  tokens?: SearchToken<T>[];
  value: string;
}) {
  const [isFocused, setFocused] = useState(false);
  // Put away by a pick, so the rows it narrowed show, and brought back by ↓.
  const [isOffering, setOffering] = useState(true);
  const [highlight, setHighlight] = useState(-1);
  if (!isFocused && !isOffering) {
    setOffering(true);
  }
  const picked = tokens.map((token) => token.id);
  const suggestions =
    isFocused && isOffering && value === ""
      ? offered.filter((token) => !picked.includes(token.id))
      : [];
  const highlighted =
    highlight >= 0 && highlight < suggestions.length ? highlight : -1;
  const pick = (id: T) => {
    onTokensChange?.([...picked, id]);
    setHighlight(-1);
    setOffering(false);
  };
  const isSearched = value !== "" || tokens.length > 0;
  return (
    <Popover open={suggestions.length > 0}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "relative flex h-9 min-w-0 flex-1 items-center gap-1 rounded-lg border border-transparent pl-8 text-sm",
            isSearched ? "pr-7" : "pr-3",
            // A faint well at rest that darkens a touch under the pointer,
            // and the raised white field once it is typed into.
            "bg-foreground/4 hover:bg-foreground/6",
            "focus-within:border-input focus-within:bg-background focus-within:shadow-sm focus-within:hover:bg-background",
            "dark:focus-within:bg-input/30",
          )}
        >
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          {tokens.map((token) => (
            <span
              className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-foreground/8 pr-0.5 pl-1.5 text-xs font-medium"
              data-search-token={token.id}
              key={token.id}
            >
              <span className="flex size-3.5 items-center justify-center [&_svg]:size-3.5">
                {token.icon}
              </span>
              {token.label}
              <button
                aria-label={`Remove ${token.label}`}
                className="grid size-4 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  onTokensChange?.(picked.filter((id) => id !== token.id));
                }}
                // The field keeps the keyboard.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                type="button"
              >
                <XIcon className="size-2.5" weight="bold" />
              </button>
            </span>
          ))}
          <input
            aria-label="Search chats"
            className="h-full w-0 min-w-12 flex-1 bg-transparent text-ellipsis outline-hidden placeholder:text-muted-foreground"
            onBlur={() => {
              setFocused(false);
              onFocusChange?.(false);
            }}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            onFocus={() => {
              setFocused(true);
              onFocusChange?.(true);
            }}
            onKeyDown={(event) => {
              if (!isOffering && value === "" && event.key === "ArrowDown") {
                event.preventDefault();
                setOffering(true);
                return;
              }
              if (suggestions.length > 0 && event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((highlighted + 1) % suggestions.length);
                return;
              }
              if (suggestions.length > 0 && event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight(
                  highlighted <= 0 ? suggestions.length - 1 : highlighted - 1,
                );
                return;
              }
              const chosen = suggestions[highlighted];
              if (event.key === "Enter" && chosen !== undefined) {
                event.preventDefault();
                pick(chosen.id);
                return;
              }
              if (
                event.key === "Backspace" &&
                value === "" &&
                picked.length > 0 &&
                event.currentTarget.selectionStart === 0
              ) {
                event.preventDefault();
                onTokensChange?.(picked.slice(0, -1));
                return;
              }
              if (event.key === "Escape" && isSearched) {
                event.preventDefault();
                event.stopPropagation();
                if (value === "") {
                  onTokensChange?.([]);
                } else {
                  onChange("");
                }
              }
            }}
            placeholder={tokens.length > 0 ? "" : placeholder}
            ref={inputRef}
            type="text"
            value={value}
          />
          {isSearched && (
            <button
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange("");
                onTokensChange?.([]);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              type="button"
            >
              <XIcon className="size-2.5" weight="bold" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-48 p-1"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        sideOffset={6}
      >
        <div className="px-2 pt-1 pb-1 text-xs text-muted-foreground">
          Show only
        </div>
        <div aria-label="Show only" role="listbox">
          {suggestions.map((token, at) => (
            <div
              aria-selected={at === highlighted}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2 text-sm [&_svg]:size-4",
                at === highlighted && "bg-accent",
              )}
              key={token.id}
              onClick={() => {
                pick(token.id);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                setHighlight(at);
              }}
              role="option"
            >
              {token.icon}
              {token.label}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
