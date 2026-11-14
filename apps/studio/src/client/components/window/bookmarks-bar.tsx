import { useOpenAddress } from "@/client/bookmarks/open-address";
import { bookmarksAtom } from "@/client/bookmarks/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { noteTypedPage } from "@/client/hooks/use-browser-history";
import { filesHrefAtom } from "@/client/atoms/window";
import { cn } from "@/client/lib/utils";
import { placeOf } from "@/shared/bookmarks";
import { folderHref } from "@/shared/computer-href";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { isInstrumentAddress } from "@instrument-org/shared";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/CaretDoubleRight";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { StarIcon } from "@phosphor-icons/react/Star";
import { useAtomValue } from "jotai";
import { useLayoutEffect, useRef, useState } from "react";

import { AddressMark } from "./app-chip";
import { BookmarkContextMenu, bookmarkClicks } from "./bookmark-menu";
import { type Place, useFilesPlaces } from "./group-new-tab";
import { BookmarkNameField, bookmarkName, useBookmarkEdits } from "./web-start";

/**
 * Whether a tab shows the bookmarks bar: the new tab always, where it says
 * how a bookmark gets there while there are none, and a page while the bar
 * has some.
 */
export function useHasBookmarksBar(isNewTab: boolean): boolean {
  const bookmarks = useAtomValue(bookmarksAtom);
  return isNewTab || bookmarks.some((bookmark) => placeOf(bookmark) === "bar");
}

/**
 * The bookmarks kept on the bar, in a row under a tab's toolbar, each the
 * mark its tab wears and a short name, the way a browser's bookmarks bar
 * keeps them, after Files where the row is given it (`files`). Those past
 * the row's end are under a chevron at its right. A click opens one in this
 * tab (a site by `onOpen`, a place of the app's own by `onVisit`), a
 * Cmd-click or a middle click in a new tab behind this one, a Shift-click as
 * a new tab group, and a right click offers the rest (`BookmarkContextMenu`).
 */
export function BookmarksBar({
  files,
  onOpen,
  onVisit,
}: {
  /** Files for a group, opening a folder (`onOpen`) as that group's bar does. */
  files?: { group: string; onOpen: (href: string) => void };
  onOpen: (url: string) => void;
  /** A place of the app's own in this tab, where a tab can stand at it; the window opens it otherwise. */
  onVisit?: (href: string) => void;
}) {
  const bookmarks = useAtomValue(bookmarksAtom).filter(
    (bookmark) => placeOf(bookmark) === "bar",
  );
  const edits = useBookmarkEdits();
  // The bookmark whose name is being typed over, by id.
  const [renamingId, setRenamingId] = useState<string>();
  const row = useRef<HTMLDivElement>(null);
  // How many fit before the row's end, the rest under the chevron.
  const [fitting, setFitting] = useState(bookmarks.length);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const room = element.clientWidth;
      const marks = [...element.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const past = marks.findIndex(
        (mark) => mark.offsetLeft + mark.offsetWidth > room,
      );
      setFitting(past === -1 ? marks.length : past);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [bookmarks, renamingId]);
  // A bookmark is an address the person chose, so opening a site's counts
  // the way typing it would.
  const openAddress = useOpenAddress({
    page: onOpen,
    ...(onVisit ? { screen: onVisit } : {}),
  });
  const open: typeof openAddress = (address, how) => {
    if (!isInstrumentAddress(address)) {
      noteTypedPage(address);
    }
    openAddress(address, how);
  };
  const overflow = bookmarks.slice(fitting);

  return (
    <div
      aria-label="Bookmarks"
      className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-1.5"
      role="toolbar"
    >
      {files && (
        <>
          <FilesMark group={files.group} onOpen={files.onOpen} />
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
        </>
      )}
      {bookmarks.length === 0 ? (
        <NoBookmarks />
      ) : (
        // Every mark is laid out, the ones past the end kept out of sight,
        // so where each one ends can be read off the row as it stands.
        <div
          className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
          ref={row}
        >
          {bookmarks.map((bookmark, index) => {
            const name = bookmarkName(bookmark);
            const isOver = index >= fitting;
            if (bookmark.id === renamingId) {
              return (
                <div
                  className="flex h-6 w-40 shrink-0 items-center gap-1.5 px-1.5"
                  key={bookmark.id}
                >
                  <AddressMark address={bookmark.url} />
                  <BookmarkNameField
                    name={name}
                    onCancel={() => {
                      setRenamingId(undefined);
                    }}
                    onCommit={(title) => {
                      setRenamingId(undefined);
                      edits.rename(bookmark, title);
                    }}
                  />
                </div>
              );
            }
            return (
              <BookmarkContextMenu
                bookmark={bookmark}
                key={bookmark.id}
                onRename={() => {
                  setRenamingId(bookmark.id);
                }}
                open={open}
              >
                <button
                  {...(isOver ? { "aria-hidden": true, tabIndex: -1 } : {})}
                  className={cn(
                    "flex h-6 max-w-40 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/80 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8",
                    isOver && "invisible",
                  )}
                  {...bookmarkClicks(bookmark, open)}
                  title={`${name}\n${bookmark.url}`}
                  type="button"
                >
                  <AddressMark address={bookmark.url} />
                  <span className="min-w-0 truncate">{name}</span>
                </button>
              </BookmarkContextMenu>
            );
          })}
        </div>
      )}
      {overflow.length > 0 && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label="More bookmarks"
            className="grid size-6 shrink-0 cursor-default place-items-center rounded-md text-foreground/60 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8"
          >
            <CaretDoubleRightIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-72 min-w-48">
            {overflow.map((bookmark) => (
              <DropdownMenuItem
                key={bookmark.id}
                {...bookmarkClicks(bookmark, open)}
                title={bookmark.url}
              >
                <AddressMark address={bookmark.url} />
                <span className="min-w-0 truncate">
                  {bookmarkName(bookmark)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Files at the bar's start: a press opens it where it last stood, and the
 * chevron beside it lists the places the Files sidebar keeps, the group's
 * project first, to open it at one of them.
 */
function FilesMark({
  group,
  onOpen,
}: {
  group: string;
  onOpen: (href: string) => void;
}) {
  const filesHref = useAtomValue(filesHrefAtom);
  const { places, project } = useFilesPlaces(group);
  const placeItem = (place: Place) => (
    <DropdownMenuItem
      key={place.path}
      onSelect={() => {
        onOpen(folderHref(place.path));
      }}
      title={place.path}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {place.icon}
      </span>
      <span className="min-w-0 truncate">{place.name}</span>
    </DropdownMenuItem>
  );
  return (
    <div className="flex h-6 shrink-0 items-center rounded-md text-xs text-foreground/80 has-data-[state=open]:bg-foreground/8 has-[button:hover]:bg-foreground/5">
      <button
        className="flex h-6 cursor-default items-center gap-1.5 rounded-l-md pr-1 pl-1.5 hover:bg-foreground/8 hover:text-foreground"
        onClick={() => {
          onOpen(filesHref);
        }}
        type="button"
      >
        <FileSystemFolderGlyph className="h-3 w-auto" />
        Files
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label="Open Files at a place"
          className="grid h-6 w-4.5 cursor-default place-items-center rounded-r-md text-foreground/60 hover:bg-foreground/8 hover:text-foreground data-[state=open]:text-foreground"
        >
          <CaretDownIcon className="size-2.5" weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-72 min-w-48">
          {project && (
            <>
              <DropdownMenuLabel>Project</DropdownMenuLabel>
              {placeItem(project)}
              {places.length > 0 && <DropdownMenuSeparator />}
            </>
          )}
          {places.length > 0 && (
            <>
              <DropdownMenuLabel>Places</DropdownMenuLabel>
              {places.map(placeItem)}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The bar before it has bookmarks: where they come from, with the star that keeps one. */
function NoBookmarks() {
  return (
    <p className="flex min-w-0 items-center gap-1 truncate px-1.5 text-xs text-muted-foreground">
      Press
      <StarIcon
        aria-label="the star"
        className="size-3.5 shrink-0 text-foreground/70"
      />
      at the end of an address to bookmark it
    </p>
  );
}
