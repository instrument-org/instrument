import { PageFavicon } from "@/client/components/favicon";
import { webSearchLabel } from "@/client/lib/resolve-url-or-search";
import { cn } from "@/client/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";

import { type PageRow } from "./page-rows";
import { pageRowText, ResultRow } from "./result-row";

/**
 * The list under a new tab's box: the pages one word finds, and last the
 * words as a web search, in the rows the address field lists them in. The
 * one lit is the one the arrows moved to.
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
  onOpen: (row: PageRow) => void;
  onSearch: () => void;
  rows: PageRow[];
  /** What the last row searches the web for; none leaves the row out. */
  searchWords: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl bg-card p-1 shadow-xs ring-1 ring-foreground/6",
        className,
      )}
      data-slot="new-tab-pages"
      role="listbox"
    >
      {rows.map((row, index) => (
        <ResultRow
          {...pageRowText(row)}
          icon={
            <PageFavicon
              className="size-4"
              favicon={row.page.favicon}
              hasTooltip={false}
              url={row.page.url}
            />
          }
          isLit={index === lit}
          key={row.address}
          onOpen={() => {
            onOpen(row);
          }}
        />
      ))}
      {searchWords !== undefined && (
        <ResultRow
          icon={<MagnifyingGlassIcon className="size-4" />}
          isLit={lit === rows.length}
          name={webSearchLabel(searchWords)}
          onOpen={onSearch}
        />
      )}
    </div>
  );
}
