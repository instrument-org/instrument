import { PageFavicon } from "@/client/components/favicon";
import { Kbd } from "@/client/components/ui/kbd";
import { cn } from "@/client/lib/utils";

import { type BoxPageRow } from "./new-tab-box";
import { bareAddress, siteOf } from "./omnibar-match";
import { RowText } from "./row-text";

/**
 * The pages under a new tab's box while it holds one word: the site the box
 * finished the words to by its address, and each other page by its title
 * and its site, the lit one marked with the key that opens it.
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
          key={`${row.kind}:${row.page.url}`}
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
          {row.kind === "site" ? (
            <RowText name={bareAddress(row.page.url)} where={undefined} />
          ) : (
            <RowText
              name={row.page.title || bareAddress(row.page.url)}
              where={siteOf(row.page.url)}
            />
          )}
          {index === lit && <Kbd>↵</Kbd>}
        </button>
      ))}
    </div>
  );
}
