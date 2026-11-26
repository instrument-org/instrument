import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { PageFavicon } from "@/client/components/favicon";
import { shownTypedPath } from "@/client/lib/locate-typed-path";
import { webSearchLabel } from "@/client/lib/resolve-url-or-search";
import { typedAddress } from "@/client/lib/typed-address";
import { typedFileName } from "@/client/lib/typed-path";
import { cn } from "@/client/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";

import { useAppsBySlug } from "./apps-by-slug";
import { type BoxOpens } from "./new-tab-box";
import { type OfferedPage } from "./omnibar-match";
import { type PageRow } from "./page-rows";
import { pageRowText, ResultRow } from "./result-row";
import { useShell } from "./shell-context";
import {
  isKnownSite,
  TypedAddressMark,
  typedAddressLabel,
  typedAddressName,
} from "./typed-address-row";

/**
 * The list under a new tab's box: first what Return opens, when it opens
 * something, then the pages one word finds, and last the words as a web
 * search, in the rows the address field and the command menu list them in.
 * The one lit is the one the arrows moved to, or else the row Return opens.
 */
export function NewTabPageList({
  className,
  lit,
  onGo,
  onOpen,
  onSearch,
  opens,
  pages,
  rows,
  searchWords,
}: {
  className?: string;
  /** The row the arrows moved to, the search row after the pages; -1 is none. */
  lit: number;
  onGo: () => void;
  onOpen: (row: PageRow) => void;
  onSearch: () => void;
  /** What Return opens from the box, the list's first row; none leaves it out. */
  opens: BoxOpens | undefined;
  /** The pages the window knows, for whether a typed site wears its icon. */
  pages: OfferedPage[];
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
      {opens !== undefined && (
        <GoRow isLit={lit === -1} onGo={onGo} opens={opens} pages={pages} />
      )}
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

/**
 * The row for what Return opens from the box, as the command menu and the
 * address field show the same words: an address as Go to and its name, a
 * place on the computer by its path.
 */
function GoRow({
  isLit,
  onGo,
  opens,
  pages,
}: {
  isLit: boolean;
  onGo: () => void;
  opens: BoxOpens;
  pages: OfferedPage[];
}) {
  const appsBySlug = useAppsBySlug();
  const { chatTitles } = useShell();
  if (opens.kind === "path") {
    const fileName = typedFileName(opens.path);
    return (
      <ResultRow
        icon={
          fileName === undefined ? (
            <FileSystemFolderGlyph className="h-3 w-auto" />
          ) : (
            <FileTypeIcon className="size-4" fileName={fileName} />
          )
        }
        isLit={isLit}
        name={shownTypedPath(opens.path)}
        onOpen={onGo}
      />
    );
  }
  const address =
    opens.kind === "address" ? opens.address : typedAddress(opens.url);
  if (address === undefined) {
    return null;
  }
  return (
    <ResultRow
      icon={
        <TypedAddressMark
          address={address}
          className="size-4"
          isKnown={address.kind === "page" && isKnownSite(address.url, pages)}
        />
      }
      isLit={isLit}
      name={typedAddressLabel(
        typedAddressName(address, { appsBySlug, chatTitles }),
      )}
      onOpen={onGo}
    />
  );
}
