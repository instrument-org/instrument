import {
  pinsAtom,
  type VisitedPage,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { resolveUrlOrSearch } from "@/client/lib/resolve-url-or-search";
import { siteFromWords } from "@/client/lib/site-from-words";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { type Icon } from "@phosphor-icons/react";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";

import { AppIcon } from "./app-icon";
import { computerName } from "./computer-name";
import { PageSection } from "./page-section";
import { SiteIcon } from "./sidebar";
import { VisitedPageRows } from "./visited-page-rows";

/** How many pages lately seen the view lists. */
const RECENT_SHOWN = 12;

/** How many pages the address field offers as it is typed into. */
const SUGGESTIONS_SHOWN = 6;

// The matcher the window's own box uses: typed letters in order, close
// together, so "wiki desk" finds the standing desk page.
const fuzzy = new uFuzzy({ intraMode: 1 });

const preventDefault = (event: Event) => {
  event.preventDefault();
};

/** One thing the address field offers for what was typed: a row of the list under it. */
interface AddressRow {
  icon: ReactNode;
  id: string;
  /** A second line under the name: the page's site. */
  line?: string;
  name: string;
  note: string;
  run: () => void;
}

/**
 * The empty band under a draft's words: three tiles for what can be opened
 * beside it (the web, this Mac, apps), each a picture of the kind of thing
 * rather than of anything in it, and under them, apart, a slim strip for
 * attaching, which is also where files are dropped. The words keep the room
 * above; the strip sits at the band's foot.
 *
 * The web opens as a tab of the draft's own, at the browser's starting view;
 * This Mac opens the Finder at home the same way; Apps goes to where apps
 * live.
 */
export function ComposeZeroState({
  onAttachFiles,
  onAttachFolder,
  onOpenApps,
  onOpenBrowser,
  onOpenFolder,
}: {
  /** The file chooser, for the strip's button. */
  onAttachFiles: () => void;
  /** The folder chooser: a folder the chat may work in, attached rather than opened. */
  onAttachFolder: () => void;
  /** Takes the window to the Apps place. */
  onOpenApps: () => void;
  /** Opens the browser's starting view as a tab of the draft's. */
  onOpenBrowser: () => void;
  onOpenFolder: (hostPath: string) => void;
}) {
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const home = places.data?.favorites.find((place) => place.name === "Home");

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-4">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <Tile icon={GlobeIcon} name="Browser" onOpen={onOpenBrowser} />
        <Tile
          icon={DesktopIcon}
          name={computerName()}
          onOpen={() => {
            onOpenFolder(home?.path ?? "~");
          }}
        />
        <Tile icon={SquaresFourIcon} name="Apps" onOpen={onOpenApps} />
      </div>
      <div className="mt-auto flex h-10 shrink-0 items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 text-[12px] text-gray-500 dark:border-gray-600 dark:text-gray-400">
        <span className="min-w-0 flex-1 truncate">Drop files here</span>
        <Chooser icon={PaperclipIcon} onPick={onAttachFiles}>
          Attach files
        </Chooser>
        <Chooser icon={FolderIcon} onPick={onAttachFolder}>
          Add a folder
        </Chooser>
      </div>
    </div>
  );
}

/**
 * The web's starting view, laid out as a browser's new tab: the sites kept
 * as large marks with their names under them, the way apps are, and the
 * pages lately seen under those as a list. In a draft's band the caret waits
 * in an address field over them; beside a chat the tab's own bar is where an
 * address goes, so the view is only the sites. Anywhere it goes arrives as a
 * tab.
 */
export function WebStart({
  hasAddressField = true,
  onOpenPage,
}: {
  /** Whether the view carries its own address field; off where the tab's bar already is one. */
  hasAddressField?: boolean;
  onOpenPage: (url: string) => void;
}) {
  const pins = useAtomValue(pinsAtom);
  const visited = useAtomValue(visitedPagesAtom);
  const bookmarks = pins.filter((pin) => pin.kind === "page");
  const recent = visited
    .filter((page) => !bookmarks.some((pin) => pin.target === page.url))
    .slice(0, RECENT_SHOWN)
    .map((page) => ({
      app: { name: hostOf(page.url), site: originOf(page.url) },
      page,
    }));
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-7 pb-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        {hasAddressField && (
          <AddressField autoFocus onOpenPage={onOpenPage} pages={visited} />
        )}
        <PageSection title="Bookmarks">
          {bookmarks.length > 0 ? (
            // Pulled in by the gap between a mark's box and its icon, so the
            // icons line up under the heading.
            <div className="-ml-4 flex flex-wrap gap-x-2 gap-y-4">
              {bookmarks.map((pin) => (
                <button
                  className="group flex w-24 flex-col items-center gap-1.5 rounded-xl py-2 text-center hover:bg-accent/50"
                  key={pin.id}
                  onClick={() => {
                    onOpenPage(pin.target);
                  }}
                  title={`${pin.title}\n${pin.target}`}
                  type="button"
                >
                  <AppIcon
                    className="transition-shadow group-hover:shadow-md"
                    name={pin.title}
                    site={originOf(pin.target)}
                    size="xl"
                  />
                  <span className="w-full truncate text-[13px] leading-4 font-medium">
                    {pin.title || hostOf(pin.target)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pin a tab, and the site is kept here.
            </p>
          )}
        </PageSection>
        {recent.length > 0 && (
          <PageSection title="Recent pages">
            <div className="-mx-2">
              <VisitedPageRows isCompact onOpen={onOpenPage} visits={recent} />
            </div>
          </PageSection>
        )}
      </div>
    </div>
  );
}

/**
 * The address field, the way the window's own box works: as it is typed
 * into, a list opens under it with what the words are first (a site to
 * open, or a search for them) and the pages lately seen whose title or site
 * they match after that, the first row reached already, the arrows moving
 * along them, Enter opening the one reached, and a press on a row the same.
 * The list floats over the band rather than sitting in it, so nothing under
 * the field moves as it fills.
 */
function AddressField({
  autoFocus = false,
  onOpenPage,
  pages,
}: {
  autoFocus?: boolean;
  onOpenPage: (url: string) => void;
  pages: VisitedPage[];
}) {
  const [typed, setTyped] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [isFocused, setFocused] = useState(false);
  // The field's box, which the list is sized to.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const words = typed.trim();
  const site = siteFromWords(words);
  const rows: AddressRow[] = words
    ? [
        site
          ? {
              icon: <GlobeIcon className="size-4" />,
              id: "site",
              name: `Open ${site.host}`,
              note: "Site",
              run: () => {
                onOpenPage(site.url);
              },
            }
          : {
              icon: <MagnifyingGlassIcon className="size-4" />,
              id: "search",
              name: `Search for “${words}”`,
              note: "Browser",
              run: () => {
                const url = resolveUrlOrSearch(words);
                if (url) {
                  onOpenPage(url);
                }
              },
            },
        ...pages
          .filter(
            (page) =>
              page.url !== site?.url &&
              (fuzzy.filter([page.title || hostOf(page.url)], words)?.length ??
                0) > 0,
          )
          .slice(0, SUGGESTIONS_SHOWN)
          .map((page) => ({
            icon: <SiteIcon favicon={page.favicon} url={page.url} />,
            id: page.url,
            line: hostOf(page.url),
            name: page.title || hostOf(page.url),
            note: "Page",
            run: () => {
              onOpenPage(page.url);
            },
          })),
      ]
    : [];
  const current = Math.min(highlight, Math.max(0, rows.length - 1));
  const isOpen = isFocused && rows.length > 0;
  const choose = (row: AddressRow) => {
    setTyped("");
    setHighlight(0);
    row.run();
  };
  return (
    <Popover open={isOpen}>
      <PopoverAnchor asChild>
        <form
          className="flex h-11 items-center px-3"
          onSubmit={(event) => {
            event.preventDefault();
            const row = rows[current];
            if (row) {
              choose(row);
            }
          }}
        >
          <label
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-muted px-2.5 text-[12px] focus-within:ring-1 focus-within:ring-ring"
            ref={setAnchor}
          >
            <MagnifyingGlassIcon className="size-3 shrink-0 text-muted-foreground" />
            <input
              aria-activedescendant={
                isOpen ? `address-row-${rows[current]?.id ?? ""}` : undefined
              }
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-label="Address or search"
              autoFocus={autoFocus}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              onBlur={() => {
                setFocused(false);
              }}
              onChange={(event) => {
                setTyped(event.target.value);
                setHighlight(0);
              }}
              onFocus={() => {
                setFocused(true);
              }}
              onKeyDown={(event) => {
                switch (event.key) {
                  case "ArrowDown":
                  case "ArrowUp": {
                    if (rows.length === 0) {
                      return;
                    }
                    event.preventDefault();
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setHighlight((current + step + rows.length) % rows.length);
                    break;
                  }
                  case "Escape": {
                    setTyped("");
                    setHighlight(0);
                    break;
                  }
                  // No default
                }
              }}
              placeholder="Type an address or search"
              role="combobox"
              spellCheck={false}
              type="text"
              value={typed}
            />
          </label>
        </form>
      </PopoverAnchor>
      {/* The caret owns this list, so it never takes focus or the pointer
          from the field: a row is chosen on mousedown, before the field
          could blur, and the list closes with the caret leaving. */}
      <PopoverContent
        align="start"
        avoidCollisions={false}
        className="p-1"
        maxHeight="18rem"
        onCloseAutoFocus={preventDefault}
        onFocusOutside={preventDefault}
        onInteractOutside={preventDefault}
        onOpenAutoFocus={preventDefault}
        side="bottom"
        sideOffset={6}
        style={{ width: anchor?.offsetWidth }}
      >
        <ul aria-label="What the address opens" role="listbox">
          {rows.map((row, index) => (
            <li
              aria-selected={index === current}
              id={`address-row-${row.id}`}
              key={row.id}
              role="option"
            >
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                  index === current ? "bg-accent" : "hover:bg-accent/50",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(row);
                }}
                onMouseMove={() => {
                  if (index !== current) {
                    setHighlight(index);
                  }
                }}
                tabIndex={-1}
                type="button"
              >
                <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_img]:size-4 [&_svg]:size-4">
                  {row.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-foreground">
                    {row.name}
                  </span>
                  {row.line !== undefined && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {row.line}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {row.note}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** One of the two choosers on the Attach strip: its own mark, so files and a folder read as the two things they are. */
function Chooser({
  children,
  icon: ChooserIcon,
  onPick,
}: {
  children: ReactNode;
  icon: Icon;
  onPick: () => void;
}) {
  return (
    <button
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground shadow-xs hover:bg-accent"
      onClick={onPick}
      type="button"
    >
      <ChooserIcon className="size-3.5 text-muted-foreground" />
      {children}
    </button>
  );
}

/** The site a page is on, as its bar would name it. */
function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : url;
}

/**
 * One kind of thing the band can open, drawn large as that kind: its mark in
 * a pane of its own, the name under it. Never a picture of anything real in
 * it, so the three read as three choices rather than three things to read.
 */
function Tile({
  icon: TileIcon,
  name,
  onOpen,
}: {
  icon: Icon;
  name: string;
  onOpen: () => void;
}) {
  return (
    <button
      className="group/tile flex flex-col items-center gap-2 rounded-xl p-1.5 text-[12px] font-medium text-foreground hover:bg-black/4 dark:hover:bg-white/6"
      onClick={onOpen}
      type="button"
    >
      <span className="grid aspect-[4/3] w-full place-items-center rounded-lg bg-card shadow-xs ring-1 ring-border/70 transition group-hover/tile:ring-border">
        <TileIcon className="size-9 text-muted-foreground transition group-hover/tile:text-foreground" />
      </span>
      <span className="max-w-full truncate">{name}</span>
    </button>
  );
}
