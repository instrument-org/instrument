import { targetOfAddress } from "@/client/bookmarks/address";
import { useOpenAddress } from "@/client/bookmarks/open-address";
import { useBookmarkFolders } from "@/client/bookmarks/folders";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  type OpenOptions,
  useWindow,
} from "@/client/components/window/context";
import { noteTypedPage } from "@/client/hooks/use-browser-history";
import { filesHrefAtom } from "@/client/atoms/window";
import { BAR_MOTION } from "@/client/lib/motion";
import { cn } from "@/client/lib/utils";
import { barItems, type Bookmark } from "@/shared/bookmarks";
import { folderHref } from "@/shared/computer-href";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/CaretDoubleRight";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { StarIcon } from "@phosphor-icons/react/Star";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AddressMark } from "./app-chip";
import {
  BookmarkContextMenu,
  NewFolderItem,
  type OpenAddress,
  ShowBookmarksBarItem,
  bookmarkClicks,
  useShowsBookmarksBar,
} from "./bookmark-menu";
import {
  BookmarkNameDialog,
  FolderChip,
  OverflowFolder,
  useOpenFolder,
} from "./bookmark-folders";
import { dragAtom } from "./drag/session";
import { DROP_TONE } from "./drag/tone";
import { pressBookmark } from "./drag/press-bookmark";
import {
  useBookmarksTarget,
  useShownBookmarks,
} from "./drag/use-bookmarks-drag";
import { type Place, useFilesPlaces } from "./files-places";
import { useShell } from "./shell-context";
import { useTabTitle } from "./tab-title";
import { BookmarkNameField, bookmarkName, useBookmarkEdits } from "./web-start";

/**
/**
 * The bookmarks kept on the bar, in a row under a tab's toolbar, each the
 * mark its tab wears and a short name, the way a browser's bookmarks bar
 * keeps them, after Files where the row is given it (`files`). Those past
 * the row's end are under a chevron at its right. A click opens one in this
 * tab whatever it names (a site by `onOpen`, a place of the app's own, a
 * chat's included, by `onVisit`), a Cmd-click or a middle click in a new tab
 * behind this one, a Shift-click in a new tab in front, and a right click
 * offers the rest (`BookmarkContextMenu`). Files and its places open the
 * same way.
 * A bookmark dragged along the bar moves there, a tab dragged onto it is
 * kept there, and either stands where it would be while it is held. A right
 * click on the bar itself offers to hide it; hidden, it is not drawn in any
 * tab of any window, and nothing can be dropped onto it. Shown or hidden
 * while a tab is open, it grows in or folds away and fades (`BAR_MOTION`),
 * the page under it moving with it; a tab opening draws it as it stands.
 */
export function BookmarksBar(props: BarProps) {
  const isShown = useShowsBookmarksBar();
  const isReduced = useReducedMotion() === true;
  return (
    <AnimatePresence initial={false}>
      {isShown && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="shrink-0 overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={isReduced ? { duration: 0 } : BAR_MOTION}
        >
          <Bar {...props} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type BarProps = {
  /** Files at the bar's start, with the places of this group's Files sidebar. */
  files?: { group: string };
  onOpen: (url: string) => void;
  /** A place of the app's own in this tab, where a tab can stand at it; the window opens it otherwise. */
  onVisit?: (href: string) => void;
};

function Bar({ files, onOpen, onVisit }: BarProps) {
  const { chatTitles } = useShell();
  const state = useAtomValue(bookmarksStateAtom);
  const items = useShownBookmarks(barItems(state), useTabTitle(chatTitles));
  const edits = useBookmarkEdits();
  const folders = useBookmarkFolders();
  const bar = useRef<HTMLDivElement>(null);
  // The bookmark or folder whose name is being typed over, by id.
  const [renamingId, setRenamingId] = useState<string>();
  const { chip, setOpenFolder } = useOpenFolder();
  // What is being named in a dialog: a new folder, placed after the item
  // whose menu asked for it, or a bookmark in a folder's menu.
  const [naming, setNaming] = useState<
    | { after?: string; kind: "folder" }
    | { bookmark: Bookmark; kind: "bookmark" }
  >();
  const row = useRef<HTMLDivElement>(null);
  // How many fit before the row's end, the rest under the chevron.
  const [fitting, setFitting] = useState(items.length);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) {
      return;
    }
    const measure = () => {
      // The row's padding is room for a focused mark's ring, not for a mark.
      const room =
        element.clientWidth -
        Number.parseFloat(getComputedStyle(element).paddingRight);
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
  }, [items, renamingId]);
  useFolderMenusInDrag(setOpenFolder);
  // A bookmark is an address the person chose, so opening a site's counts
  // the way typing it would.
  const openAddress = useOpenAddress({
    loadHere: onOpen,
    ...(onVisit ? { visitHere: onVisit } : {}),
  });
  const open: typeof openAddress = (address, asked) => {
    if (targetOfAddress(address)?.kind === "page") {
      noteTypedPage(address);
    }
    openAddress(address, asked);
  };
  const appWindow = useWindow();
  /** Files at a place: in this tab with no options, else where they place it. */
  const openFilesAt = (href: string, asked?: OpenOptions) => {
    if (asked === undefined && onVisit) {
      onVisit(href);
    } else {
      appWindow.openScreen(href, asked);
    }
  };
  const overflow = items.slice(fitting).filter((item) => !item.isStanding);
  const drag = useAtomValue(dragAtom);
  const litFolder =
    drag?.landing?.kind === "bookmarks" ? drag.landing.folder : undefined;
  useBookmarksTarget({
    area: () => bar.current,
    row: () => row.current,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            aria-label="Bookmarks"
            className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-1.5"
            ref={bar}
            role="toolbar"
          >
            {files && (
              <>
                <FilesMark group={files.group} open={openFilesAt} />
                <span
                  aria-hidden
                  className="mx-1 h-4 w-px shrink-0 bg-border"
                />
              </>
            )}
            {items.length === 0 ? (
              <NoBookmarks />
            ) : (
              // Every mark is laid out, the ones past the end kept out of sight,
              // so where each one ends can be read off the row as it stands. The
              // row clips them, so it pads them by a focus ring's width, drawn
              // outside a mark, and gives the width back at its sides.
              <div
                className="relative -mx-0.5 flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden p-0.5"
                ref={row}
              >
                {items.map((item, index) => {
                  const isOver = index >= fitting;
                  if (item.kind === "folder") {
                    const { folder } = item;
                    if (folder.id === renamingId) {
                      return (
                        <NameInPlace
                          id={folder.id}
                          key={folder.id}
                          mark={
                            <FolderSimpleIcon className="size-3.5 shrink-0 text-foreground/60" />
                          }
                          name={folder.title}
                          onDone={(title) => {
                            setRenamingId(undefined);
                            if (title !== undefined) {
                              folders.rename(folder, title);
                            }
                          }}
                        />
                      );
                    }
                    return (
                      <FolderChip
                        {...chip(folder.id)}
                        folder={folder}
                        isLit={litFolder === folder.id}
                        isOver={isOver}
                        items={item.items}
                        key={folder.id}
                        onNewFolder={() => {
                          setNaming({ after: folder.id, kind: "folder" });
                        }}
                        onRename={() => {
                          setRenamingId(folder.id);
                        }}
                        onRenameItem={(bookmark) => {
                          setNaming({ bookmark, kind: "bookmark" });
                        }}
                        open={open}
                      />
                    );
                  }
                  const { bookmark } = item;
                  const name = bookmarkName(bookmark);
                  if (item.isStanding) {
                    return (
                      <div
                        className={cn(
                          "flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/85",
                          DROP_TONE,
                        )}
                        data-bookmark-id={bookmark.id}
                        key={bookmark.id}
                      >
                        <AddressMark address={bookmark.url} />
                        <span className="min-w-0 truncate">{name}</span>
                      </div>
                    );
                  }
                  if (bookmark.id === renamingId) {
                    return (
                      <NameInPlace
                        id={bookmark.id}
                        key={bookmark.id}
                        mark={<AddressMark address={bookmark.url} />}
                        name={name}
                        onDone={(title) => {
                          setRenamingId(undefined);
                          if (title !== undefined) {
                            edits.rename(bookmark, title);
                          }
                        }}
                      />
                    );
                  }
                  return (
                    <BookmarkContextMenu
                      bookmark={bookmark}
                      key={bookmark.id}
                      onNewFolder={() => {
                        setNaming({ after: bookmark.id, kind: "folder" });
                      }}
                      onRename={() => {
                        setRenamingId(bookmark.id);
                      }}
                      open={open}
                    >
                      <button
                        {...(isOver
                          ? { "aria-hidden": true, tabIndex: -1 }
                          : {})}
                        className={cn(
                          "flex h-6 max-w-40 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/80 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8",
                          isOver && "invisible",
                        )}
                        {...bookmarkClicks(bookmark.url, open)}
                        data-bookmark-id={bookmark.id}
                        onPointerDown={(event) => {
                          pressBookmark(event, bookmark);
                        }}
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
                  {overflow.map((item) =>
                    item.kind === "folder" ? (
                      <OverflowFolder
                        folder={item.folder}
                        items={item.items}
                        key={item.folder.id}
                        open={open}
                      />
                    ) : (
                      <DropdownMenuItem
                        key={item.bookmark.id}
                        {...bookmarkClicks(item.bookmark.url, open)}
                        title={item.bookmark.url}
                      >
                        <AddressMark address={item.bookmark.url} />
                        <span className="min-w-0 truncate">
                          {bookmarkName(item.bookmark)}
                        </span>
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <NewFolderItem
            onSelect={() => {
              setNaming({ kind: "folder" });
            }}
          />
          <ContextMenuSeparator />
          <ShowBookmarksBarItem />
        </ContextMenuContent>
      </ContextMenu>
      {naming?.kind === "folder" && (
        <BookmarkNameDialog
          action="Create"
          name=""
          onClose={() => {
            setNaming(undefined);
          }}
          onCommit={(title) => {
            folders.create(title, naming.after);
          }}
          title="New folder"
        />
      )}
      {naming?.kind === "bookmark" && (
        <BookmarkNameDialog
          action="Save"
          name={bookmarkName(naming.bookmark)}
          onClose={() => {
            setNaming(undefined);
          }}
          onCommit={(title) => {
            edits.rename(naming.bookmark, title);
          }}
          title="Rename bookmark"
        />
      )}
    </>
  );
}

/** How long something held rests on a folder before its menu opens, to be filed at a place in it. */
const SPRING_OPEN_MS = 500;

/**
 * Folder menus while something is held, as a browser's bar has them: held
 * on a folder a moment, its menu opens, so what is held can be filed at a
 * place in it; and once it lands anywhere, the open menu closes.
 */
function useFolderMenusInDrag(
  setOpenFolder: (folder: string | undefined) => void,
) {
  const drag = useAtomValue(dragAtom);
  const resting =
    drag?.landing?.kind === "bookmarks" ? drag.landing.folder : undefined;
  useEffect(() => {
    if (resting === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setOpenFolder(resting);
    }, SPRING_OPEN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [resting, setOpenFolder]);
  const isHolding = drag !== undefined;
  const wasHolding = useRef(isHolding);
  useEffect(() => {
    if (wasHolding.current && !isHolding) {
      setOpenFolder(undefined);
    }
    wasHolding.current = isHolding;
  }, [isHolding, setOpenFolder]);
}

/** A bookmark's or folder's name being typed over in its place on the bar. */
function NameInPlace({
  id,
  mark,
  name,
  onDone,
}: {
  id: string;
  mark: React.ReactNode;
  name: string;
  /** The name typed, or nothing where it was let go. */
  onDone: (name: string | undefined) => void;
}) {
  return (
    <div
      className="flex h-6 w-40 shrink-0 items-center gap-1.5 px-1.5"
      data-bookmark-id={id}
      // The field's own text menu, not the bar's.
      onContextMenu={(event) => {
        event.stopPropagation();
      }}
    >
      {mark}
      <BookmarkNameField
        name={name}
        onCancel={() => {
          onDone(undefined);
        }}
        onCommit={onDone}
      />
    </div>
  );
}

/**
 * Files at the bar's start: a press opens it where it last stood, and the
 * chevron beside it lists the places the Files sidebar keeps, the group's
 * project first, to open it at one of them. Each opens as a bookmark does
 * (`bookmarkClicks`).
 */
function FilesMark({ group, open }: { group: string; open: OpenAddress }) {
  const filesHref = useAtomValue(filesHrefAtom);
  const { places, project } = useFilesPlaces(group);
  const placeItem = (place: Place) => (
    <DropdownMenuItem
      key={place.path}
      {...bookmarkClicks(folderHref(place.path), open)}
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
        {...bookmarkClicks(filesHref, open)}
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
