import { PageFavicon } from "@/client/components/favicon";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import { Kbd } from "@/client/components/ui/kbd";
import { cn } from "@/client/lib/utils";

import { type BoxPageRow } from "./new-tab-box";

/**
 * The pages under a new tab's box while it holds one word: each by its
 * title, when it has one, and its address, with the letters the word
 * matched in bold wherever they were found, the lit one marked with the key
 * that opens it.
 */
export function NewTabPageList({
  className,
  lit,
  onLight,
  onOpen,
  rows,
}: {
  className?: string;
  lit: number;
  onLight: (index: number) => void;
  onOpen: (row: BoxPageRow) => void;
  rows: BoxPageRow[];
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
        <button
          aria-selected={index === lit}
          className={cn(
            "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left",
            index === lit && "bg-accent",
          )}
          key={`${row.kind}:${row.address}`}
          onClick={() => {
            onOpen(row);
          }}
          onPointerMove={() => {
            if (index !== lit) {
              onLight(index);
            }
          }}
          // The caret stays in the box as a row is pressed.
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          role="option"
          tabIndex={-1}
          type="button"
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
          {index === lit && <Kbd>↵</Kbd>}
        </button>
      ))}
    </div>
  );
}
