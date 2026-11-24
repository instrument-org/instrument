import { targetOfAddress } from "@/client/bookmarks/address";
import {
  askedOfBookmark,
  useOpenAddress,
} from "@/client/bookmarks/open-address";
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
import { useFilesStartHref } from "@/client/hooks/use-files-start-href";
import { BAR_MOTION } from "@/client/lib/motion";
import { cn } from "@/client/lib/utils";
import { barItems, OTHER_ROOT, rootItems } from "@/shared/bookmarks";
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
  ManageBookmarksItem,
  NewFolderItem,
  type OpenAddress,
  ShowBookmarksBarItem,
  bookmarkClicks,
  useShowsBookmarksBar,
} from "./bookmark-menu";
import {
  BookmarkNameDialog,
  FolderChip,
  OtherBookmarksChip,
  OverflowFolder,
  useOpenFolder,
} from "./bookmark-folders";
import { dragAtom } from "./drag/session";
import { pressBookmark, pressPlace } from "./drag/press-bookmark";
import {
  useBookmarksTarget,
  marksBesides,
  useBarDropLine,
} from "./drag/use-bookmarks-drag";
import { AppsMark } from "./apps-mark";
import { ChatsMark } from "./chats-mark";
import { type Place, useFilesPlaces } from "./files-places";
import { BookmarkNameField, bookmarkName } from "./web-start";

/**
/**
 * The bookmarks kept on the bar, in a row under a tab's toolbar, each the
 * mark its tab wears and a short name, the way a browser's bookmarks bar
 * keeps them, after Apps, Chats and Files where the row is given it (`files`). Those past
 * the row's end are under a chevron at its right, and All Bookmarks, where
 * it has any, is one chip at the bar's right end. A click opens one in this
 * tab whatever it names (a site by `onOpen`, a place of the app's own, a
 * chat's included, by `onVisit`), a Cmd-click or a middle click in a new tab
 * behind this one, a Shift-click in a new tab in front, and a right click
 * offers the rest (`BookmarkContextMenu`). Apps, Chats, Files and its
 * places open the same way.
 * A bookmark or a folder dragged along the bar moves there, and a tab
 * dragged onto it is kept there. What is held stays in its place until it
 * lands, a copy on the pointer and a line where it would go
 * (`BarDropLine`), so the bar never shifts under the pointer. A right
 * click on the bar itself offers to hide it; hidden, it is not drawn in any
 * tab of any window but a new tab (`isAlwaysShown`), where it is the way to
 * Files and the sites kept, and nothing can be dropped onto it. Shown or hidden
 * while a tab is open, it grows in or folds away and fades (`BAR_MOTION`),
 * the page under it moving with it; a tab opening draws it as it stands.
 */
export function BookmarksBar({
  isAlwaysShown = false,
  ...props
}: BarProps & { isAlwaysShown?: boolean }) {
  const isShown = useShowsBookmarksBar() || isAlwaysShown;
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
  /** Drawn on the page's own ground with no line under it, where the page carries on from it: a new tab's. */
  bleeds?: boolean;
  /** Apps, Chats and Files at the bar's start, Files with the places of this group's Files sidebar. */
  files?: { group: string };
  onOpen: (url: string) => void;
  /** A place of the app's own in this tab, where a tab can stand at it; the window opens it otherwise. */
  onVisit?: (href: string) => void;
};

function Bar({ bleeds = false, files, onOpen, onVisit }: BarProps) {
  const state = useAtomValue(bookmarksStateAtom);
  const items = barItems(state);
  const others = rootItems(state, OTHER_ROOT);
  const folders = useBookmarkFolders();
  const bar = useRef<HTMLDivElement>(null);
  // The folder whose name is being typed over, by id.
  const [renamingId, setRenamingId] = useState<string>();
  const { chip, setOpenFolder } = useOpenFolder();
  // A new folder being named in a dialog, placed after the item whose menu
  // asked for it.
  const [naming, setNaming] = useState<{ after?: string; kind: "folder" }>();
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
  /** Files at a place, Chats, or Apps: in this tab with no options, else where they place it. */
  const openFilesAt = (href: string, asked?: OpenOptions) => {
    if (asked === undefined && onVisit) {
      onVisit(href);
    } else {
      appWindow.openScreen(href, asked && askedOfBookmark(asked));
    }
  };
  const overflow = items.slice(fitting);
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
            className={cn(
              "flex h-8 shrink-0 items-center gap-1 px-1.5",
              !bleeds && "border-b border-border bg-background",
            )}
            ref={bar}
            role="toolbar"
          >
            {files && (
              <>
                <AppsMark open={openFilesAt} openSite={open} />
                <ChatsMark open={openFilesAt} />
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
                        open={open}
                      />
                    );
                  }
                  const { bookmark } = item;
                  const name = bookmarkName(bookmark);
                  return (
                    <BookmarkContextMenu
                      bookmark={bookmark}
                      key={bookmark.id}
                      onNewFolder={() => {
                        setNaming({ after: bookmark.id, kind: "folder" });
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
                        {/* An unnamed bookmark is its mark alone, as in Chrome. */}
                        {bookmark.title && (
                          <span className="min-w-0 truncate">{name}</span>
                        )}
                      </button>
                    </BookmarkContextMenu>
                  );
                })}
                <BarDropLine row={row} />
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
            {others.length > 0 && (
              <div className="ml-auto flex shrink-0 items-center">
                <span
                  aria-hidden
                  className="mx-1 h-4 w-px shrink-0 bg-border"
                />
                <OtherBookmarksChip
                  {...chip(OTHER_ROOT)}
                  items={others}
                  open={open}
                />
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <NewFolderItem
            onSelect={() => {
              setNaming({ kind: "folder" });
            }}
          />
          <ManageBookmarksItem />
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
    </>
  );
}

/**
 * The line between two marks of the bar where what is held would go, drawn
 * in the gap before the mark it would stand ahead of, or after the last.
 */
function BarDropLine({ row }: { row: React.RefObject<HTMLDivElement | null> }) {
  const line = useBarDropLine();
  const [left, setLeft] = useState<number>();
  const index = line?.index;
  const moving = line?.moving.join(" ");
  useLayoutEffect(() => {
    const element = row.current;
    if (index === undefined || moving === undefined || !element) {
      setLeft(undefined);
      return;
    }
    const marks = marksBesides(element, moving.split(" "));
    const before = marks[index];
    const last = marks.at(-1);
    setLeft(
      before
        ? before.start - DROP_LINE_GAP
        : last
          ? last.start + last.size + DROP_LINE_GAP
          : DROP_LINE_GAP,
    );
  }, [index, moving, row]);
  if (left === undefined) {
    return null;
  }
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1.5 bottom-1.5 w-0.5 -translate-x-1/2 rounded-full bg-primary"
      data-slot="bookmark-drop-line"
      style={{ left }}
    />
  );
}

/** Half the gap between two marks of the bar, in px, where the line between them is drawn. */
const DROP_LINE_GAP = 1;

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
  // A folder taken up closes the menu its press opened.
  const heldFolder =
    drag?.held.kind === "folder" ? drag.held.folder : undefined;
  useEffect(() => {
    if (heldFolder !== undefined) {
      setOpenFolder(undefined);
    }
  }, [heldFolder, setOpenFolder]);
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
 * Files at the bar's start: a press opens it at the first folder under
 * Favorites, and the chevron beside it lists the places the Files sidebar
 * keeps, the group's project first, to open it at one of them. Each opens as
 * a bookmark does (`bookmarkClicks`), and drags as the same place in Files'
 * sidebar does (`pressPlace`), the menu getting out of the way as it does.
 */
function FilesMark({ group, open }: { group: string; open: OpenAddress }) {
  const filesHref = useFilesStartHref();
  const { places, project } = useFilesPlaces(group);
  const [isOpen, setOpen] = useState(false);
  const placeItem = (place: Place) => (
    <DropdownMenuItem
      key={place.path}
      {...bookmarkClicks(folderHref(place.path), open)}
      onPointerDown={(event) => {
        pressPlace(event, place, () => {
          setOpen(false);
        });
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
        {...bookmarkClicks(filesHref, open)}
        type="button"
      >
        <FileSystemFolderGlyph className="h-3 w-auto" />
        Files
      </button>
      <DropdownMenu modal={false} onOpenChange={setOpen} open={isOpen}>
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
