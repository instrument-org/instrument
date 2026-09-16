import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { Fragment, type ReactNode, useState } from "react";

/** One thing a menu offers: what stands for it, what it is called, and whether it is on. */
export interface PickEntry {
  icon: ReactNode;
  id: string;
  label: string;
  /** A small figure at the row's far edge: how many threads it reaches. */
  note?: string;
}

/** Past this many entries the menu grows a find field above them. */
const FIND_FROM = 8;

/**
 * What opens under a filter chip or a tag control: rows with a check where
 * chosen, a find field once the list is long, and whatever the caller keeps at
 * the foot. Growth lands here, never in the row of chips above the chat.
 */
export function PickList({
  chosen,
  entries,
  findPlaceholder,
  foot,
  onToggle,
  rowTrailing,
  wrapRow,
}: {
  chosen: ReadonlySet<string>;
  entries: PickEntry[];
  findPlaceholder: string;
  /** Drawn under the rows, past a hairline: an action that adds to the list. */
  foot?: ReactNode;
  onToggle: (id: string) => void;
  /** Something at a row's edge past the check, shown while the row is hovered. */
  rowTrailing?: (entry: PickEntry) => ReactNode;
  /** Wraps each row, for a menu on right click. */
  wrapRow?: (entry: PickEntry, row: ReactNode) => ReactNode;
}) {
  const [find, setFind] = useState("");
  const words = find.trim().toLowerCase();
  const shown = words
    ? entries.filter((entry) => entry.label.toLowerCase().includes(words))
    : entries;
  return (
    <div className="flex max-h-80 flex-col">
      {entries.length > FIND_FROM && (
        <div className="relative mb-1 shrink-0">
          <MagnifyingGlassIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="h-7 pl-7 text-xs"
            onChange={(event) => {
              setFind(event.target.value);
            }}
            placeholder={findPlaceholder}
            value={find}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" role="group">
        {shown.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {entries.length === 0 ? "Nothing yet." : "Nothing matches."}
          </p>
        ) : (
          shown.map((entry) => {
            const isOn = chosen.has(entry.id);
            const row = (
              <div className="group/pick flex h-7 items-center gap-2 rounded-sm px-2 text-xs hover:bg-accent">
                <button
                  aria-checked={isOn}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => {
                    onToggle(entry.id);
                  }}
                  role="menuitemcheckbox"
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {entry.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
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
                {rowTrailing?.(entry)}
              </div>
            );
            return (
              <Fragment key={entry.id}>
                {wrapRow ? wrapRow(entry, row) : row}
              </Fragment>
            );
          })
        )}
      </div>
      {foot && (
        <div className="mt-1 shrink-0 border-t border-border pt-1">{foot}</div>
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
