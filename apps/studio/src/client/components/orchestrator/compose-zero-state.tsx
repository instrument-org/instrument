import {
  pinsAtom,
  type VisitedPage,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { resolveUrlOrSearch } from "@/client/lib/resolve-url-or-search";
import { siteFromWords } from "@/client/lib/site-from-words";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import uFuzzy from "@leeoniya/ufuzzy";
import { type Icon } from "@phosphor-icons/react";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";

import { computerName } from "./computer-name";
import { SiteIcon } from "./sidebar";

/** How many sites a line shows: enough to find this morning's, few enough to stay one line. */
const SITES_SHOWN = 8;

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
 * The web opens here, in its own starting view: the address field over the
 * sites kept and lately seen, and going anywhere from it arrives as a tab in
 * this tab's place. This Mac opens the Finder at home the same way; Apps
 * goes to where apps live.
 */
export function ComposeZeroState({
  onAttachFiles,
  onAttachFolder,
  onOpenApps,
  onOpenFolder,
  onOpenPage,
}: {
  /** The file chooser, for the strip's button. */
  onAttachFiles: () => void;
  /** The folder chooser: a folder the chat may work in, attached rather than opened. */
  onAttachFolder: () => void;
  /** Takes the window to the Apps place. */
  onOpenApps: () => void;
  onOpenFolder: (hostPath: string) => void;
  onOpenPage: (url: string) => void;
}) {
  const [isBrowsing, setBrowsing] = useState(false);
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const home = places.data?.favorites.find((place) => place.name === "Home");

  if (isBrowsing) {
    return (
      <WebStart
        onBack={() => {
          setBrowsing(false);
        }}
        onOpenPage={onOpenPage}
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-4">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <Tile
          icon={GlobeIcon}
          name="Web"
          onOpen={() => {
            setBrowsing(true);
          }}
        />
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
              note: "Web",
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

/** A door's white box, its lines divided. */
function Box({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-lg bg-card shadow-xs">
      {children}
    </div>
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

/**
 * A line inside a box, with a small name at its left saying what the line
 * is, when it needs one. One row of whole things: what does not fit wraps
 * out of sight rather than being cut mid-name, and the room at the end is
 * for a way to the rest.
 */
function Line({
  children,
  label,
  trailing,
}: {
  children: ReactNode;
  label?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3 px-3 py-1">
      {label !== undefined && (
        <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex max-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-6 overflow-hidden">
        {children}
      </div>
      {trailing}
    </div>
  );
}

/** One thing to open on a line: its mark and its name, the whole of it the button. */
function Mark({
  className,
  icon,
  name,
  onOpen,
  title = name,
}: {
  className?: string;
  icon: ReactNode;
  name: string;
  onOpen: () => void;
  /** What the hover says, when it says more than the name. */
  title?: string;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-6 max-w-40 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-gray-700 hover:bg-muted dark:text-gray-300",
        className,
      )}
      onClick={onOpen}
      title={title}
      type="button"
    >
      <span className="grid size-3.5 shrink-0 place-items-center [&_img]:size-3.5 [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="truncate">{name}</span>
    </button>
  );
}

/**
 * The rest of a line, behind the clock at its end: every thing the line had
 * no room for, each by its name with where it is under it, newest first,
 * in a list that scrolls.
 */
function MorePopover({
  label,
  rows,
}: {
  label: string;
  rows: {
    icon: ReactNode;
    key: string;
    line: string;
    onOpen: () => void;
    title: string;
  }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
          title={label}
          type="button"
        >
          <ClockCounterClockwiseIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 flex-col p-0"
        maxHeight="20rem"
        side="bottom"
        sideOffset={4}
      >
        <ul
          aria-label={label}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1"
        >
          {rows.map((row) => (
            <li key={row.key}>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  row.onOpen();
                }}
                type="button"
              >
                <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_svg]:size-4">
                  {row.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-foreground">
                    {row.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {row.line}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
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

/**
 * The web's starting view: where to go, and the sites kept and lately seen.
 * The caret waits in the address field; anywhere it goes arrives as a tab.
 */
function WebStart({
  onBack,
  onOpenPage,
}: {
  onBack: () => void;
  onOpenPage: (url: string) => void;
}) {
  const pins = useAtomValue(pinsAtom);
  const visited = useAtomValue(visitedPagesAtom);
  // The sites kept first, then the pages lately seen that are not among
  // them, one per site on the line, so the line is the places a person goes
  // back to; the whole list waits behind the clock at the line's end.
  const bookmarks = pins.filter((pin) => pin.kind === "page");
  const seen = visited.filter(
    (page) => !bookmarks.some((pin) => pin.target === page.url),
  );
  const seenOrigins = new Set<string>();
  const seenOnLine = seen
    .filter((page) => {
      const origin = originOf(page.url);
      if (seenOrigins.has(origin)) {
        return false;
      }
      seenOrigins.add(origin);
      return true;
    })
    .slice(0, SITES_SHOWN);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4">
      <button
        className="inline-flex h-7 w-fit items-center gap-1.5 rounded-lg px-1.5 text-[12px] font-medium text-muted-foreground hover:bg-black/4 hover:text-foreground dark:hover:bg-white/6"
        onClick={onBack}
        type="button"
      >
        <ArrowLeftIcon className="size-3.5" />
        Web
      </button>
      <Box>
        <AddressField autoFocus onOpenPage={onOpenPage} pages={visited} />
        {bookmarks.length > 0 && (
          <Line label="Bookmarks">
            {bookmarks.slice(0, SITES_SHOWN).map((pin) => (
              <Mark
                icon={<SiteIcon favicon={pin.favicon} url={pin.target} />}
                key={pin.id}
                name={pin.title}
                onOpen={() => {
                  onOpenPage(pin.target);
                }}
              />
            ))}
          </Line>
        )}
        {seen.length > 0 && (
          <Line
            label="Recent"
            trailing={
              <MorePopover
                label="All recent pages"
                rows={seen.map((page) => ({
                  icon: <SiteIcon favicon={page.favicon} url={page.url} />,
                  key: page.url,
                  line: hostOf(page.url),
                  onOpen: () => {
                    onOpenPage(page.url);
                  },
                  title: page.title || hostOf(page.url),
                }))}
              />
            }
          >
            {seenOnLine.map((page) => (
              <Mark
                icon={<SiteIcon favicon={page.favicon} url={page.url} />}
                key={page.url}
                name={page.title || hostOf(page.url)}
                onOpen={() => {
                  onOpenPage(page.url);
                }}
                title={`${page.title || page.url}\n${page.url}`}
              />
            ))}
          </Line>
        )}
        {bookmarks.length === 0 && seen.length === 0 && (
          <Line label="Bookmarks">
            <span className="text-[11px] text-muted-foreground">
              Pin a tab, and the site is kept here.
            </span>
          </Line>
        )}
      </Box>
    </div>
  );
}
