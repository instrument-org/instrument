import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { type ReactNode, useState } from "react";

/** One thing a menu offers: what stands for it, what it is called, and whether it is on. */
export interface PickEntry {
  icon: ReactNode;
  id: string;
  label: string;
  /** Stands for none of the rest: over a hairline above them, and not among what the find field finds. */
  isNone?: boolean;
  /** A small figure at the row's far edge: how many chats it reaches. */
  note?: string;
}

/**
 * A list to pick one thing from: a find field, rows with a check on the one
 * chosen, and whatever the caller keeps at the foot.
 */
export function PickList({
  chosen,
  entries,
  findPlaceholder,
  foot,
  onPick,
}: {
  /** The id of the one that is on; none of them is without it. */
  chosen: string | undefined;
  entries: PickEntry[];
  findPlaceholder: string;
  /** Drawn under the rows, past a hairline: an action that adds to the list, told what is typed in the find field. */
  foot?: ((find: string) => ReactNode) | ReactNode;
  onPick: (id: string) => void;
}) {
  const [find, setFind] = useState("");
  const words = find.trim().toLowerCase();
  const shown = words
    ? entries.filter(
        (entry) => !entry.isNone && entry.label.toLowerCase().includes(words),
      )
    : entries;
  return (
    <div className="flex max-h-80 min-h-0 flex-col">
      <div className="relative mb-1 shrink-0">
        <MagnifyingGlassIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          className="h-7 pl-7 text-xs"
          onChange={(event) => {
            setFind(event.target.value);
          }}
          // Enter takes the one row the words leave.
          onKeyDown={(event) => {
            const [only, ...rest] = shown;
            if (event.key === "Enter" && only && rest.length === 0) {
              event.preventDefault();
              onPick(only.id);
            }
          }}
          placeholder={findPlaceholder}
          value={find}
        />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto scroll-fade-y"
        role="group"
      >
        <div>
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {entries.length === 0 ? "Nothing yet." : "Nothing matches."}
            </p>
          ) : (
            shown.map((entry) => {
              const isOn = entry.id === chosen;
              return (
                <div
                  className={cn(
                    "flex h-7 items-center gap-2 rounded-sm px-2 text-xs hover:bg-accent",
                    entry.isNone &&
                      "relative mb-2 after:absolute after:inset-x-0 after:-bottom-1 after:h-px after:bg-border",
                  )}
                  key={entry.id}
                >
                  <button
                    aria-checked={isOn}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      onPick(entry.id);
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {entry.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {entry.label}
                    </span>
                    {entry.note && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {entry.note}
                      </span>
                    )}
                    <CheckIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        isOn ? "opacity-100" : "opacity-0",
                      )}
                      weight="bold"
                    />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
      {foot && (
        <div className="mt-1 shrink-0 border-t border-border pt-1">
          {typeof foot === "function" ? foot(find.trim()) : foot}
        </div>
      )}
    </div>
  );
}

/** The one plain action a pick list keeps at its foot. */
export function PickListAction({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-xs hover:bg-accent"
      onClick={onSelect}
      role="menuitem"
      type="button"
    >
      {children}
    </button>
  );
}
