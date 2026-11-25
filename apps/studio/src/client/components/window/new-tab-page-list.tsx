import { PageFavicon } from "@/client/components/favicon";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { Kbd } from "@/client/components/ui/kbd";
import { webSearchLabel } from "@/client/lib/resolve-url-or-search";
import { cn } from "@/client/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { type ReactNode } from "react";

import { type BoxPageRow } from "./new-tab-box";

/**
 * The list under a new tab's box: the pages one word finds, each by its
 * title, when it has one, and its address, with the letters the word matched
 * in bold wherever they were found, and last the words as a web search. The
 * row the arrows moved to is marked with the key that opens it; the pointer
 * only tints a row, so Return never opens one it happens to be over.
 */
export function NewTabPageList({
  className,
  lit,
  onOpen,
  onSearch,
  rows,
  searchWords,
}: {
  className?: string;
  /** The row the arrows moved to, the search row after the pages; -1 is none. */
  lit: number;
  onOpen: (row: BoxPageRow) => void;
  onSearch: () => void;
  rows: BoxPageRow[];
  /** What the last row searches the web for; none leaves the row out. */
  searchWords: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl bg-card p-1 text-sm shadow-xs ring-1 ring-foreground/6",
        className,
      )}
      data-slot="new-tab-pages"
      role="listbox"
    >
      {rows.map((row, index) => (
        <ListRow
          isLit={index === lit}
          key={row.address}
          onOpen={() => {
            onOpen(row);
          }}
        >
          <span className="grid size-4 shrink-0 place-items-center">
            <PageFavicon
              className="size-4"
              favicon={row.page.favicon}
              hasTooltip={false}
              url={row.page.url}
            />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {row.title === "" ? (
              <span className="min-w-0 truncate">
                <FuzzyHighlight ranges={row.addressRanges} text={row.address} />
              </span>
            ) : (
              <>
                <span className="min-w-0 shrink truncate">
                  <FuzzyHighlight ranges={row.titleRanges} text={row.title} />
                </span>
                <span className="max-w-[55%] min-w-0 shrink-0 truncate text-xs text-muted-foreground">
                  <FuzzyHighlight
                    ranges={row.addressRanges}
                    text={row.address}
                  />
                </span>
              </>
            )}
          </span>
        </ListRow>
      ))}
      {searchWords !== undefined && (
        <ListRow isLit={lit === rows.length} onOpen={onSearch}>
          <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {webSearchLabel(searchWords)}
          </span>
        </ListRow>
      )}
    </div>
  );
}

function ListRow({
  children,
  isLit,
  onOpen,
}: {
  children: ReactNode;
  isLit: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      aria-selected={isLit}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left",
        isLit ? "bg-accent" : "hover:bg-accent/50",
      )}
      onClick={onOpen}
      // The caret stays in the box as a row is pressed.
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      role="option"
      tabIndex={-1}
      type="button"
    >
      {children}
      {isLit && <Kbd>↵</Kbd>}
    </button>
  );
}
