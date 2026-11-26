import { useBookmarkFolders } from "@/client/bookmarks/folders";
import {
  bookmarksToOpen,
  useOpenAllBookmarks,
} from "@/client/bookmarks/open-address";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import { Button } from "@/client/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
import { cn, commandKeyHeld } from "@/client/lib/utils";
import {
  type BarItem,
  type Bookmark,
  type BookmarkFolder,
  type BookmarkRoot,
  OTHER_ROOT,
  OTHER_ROOT_TITLE,
} from "@/shared/bookmarks";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/CaretDoubleRight";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";

import { AddressMark } from "./app-chip";
import {
  BookmarkContextMenu,
  ManageBookmarksItem,
  NewFolderItem,
  type OpenAddress,
  ShowBookmarksBarItem,
  bookmarkClicks,
  folderClicks,
  OpenAllItems,
} from "./bookmark-menu";
import { DROP_TONE } from "./drag/tone";
import { pressBookmark, pressFolder } from "./drag/press-bookmark";
import { dragAtom } from "./drag/session";
import {
  SPRING_OPEN_MS,
  useMenuDropLine,
  useMenuTarget,
} from "./drag/use-bookmarks-drag";
import { bookmarkName } from "./web-start";

/**
 * A folder on the bookmarks bar, as a browser's bar has them: a press opens
 * a menu of the bookmarks in it, and while one folder's menu is open,
 * moving onto another folder opens that one's instead (`onHover`). A middle
 * click or a Cmd-click opens every bookmark in it (`folderClicks`). A right
 * click offers to open them all, rename it, delete it, or make another
 * folder. While something is held over its middle it is lit, and letting
 * go there files it in the folder (`useBookmarksTarget`).
 */
export function FolderChip({
  folder,
  isLit,
  isOpen,
  isOver,
  items,
  onHover,
  onNewFolder,
  onOpenChange,
  onRename,
  open,
}: {
  folder: BookmarkFolder;
  /** Something held would be filed in it if let go now. */
  isLit: boolean;
  isOpen: boolean;
  /** Past the row's end, laid out but out of sight. */
  isOver: boolean;
  items: readonly Bookmark[];
  /** The pointer came onto it, which opens it while another folder's menu is open. */
  onHover: () => void;
  onNewFolder: () => void;
  onOpenChange: (open: boolean) => void;
  /** Opens the dialog that renames the folder. */
  onRename: () => void;
  open: OpenAddress;
}) {
  const edits = useBookmarkFolders();
  const renaming = useRef(false);
  const store = useStore();
  const openAll = useOpenAllBookmarks();
  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange} open={isOpen}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <DropdownMenuTrigger
            {...(isOver ? { "aria-hidden": true, tabIndex: -1 } : {})}
            className={cn(
              "flex h-6 max-w-40 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/80 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8",
              isLit && DROP_TONE,
              isOver && "invisible",
            )}
            data-bookmark-folder={folder.id}
            data-bookmark-id={folder.id}
            {...folderClicks(() => {
              openAll(
                bookmarksToOpen(store.get(bookmarksStateAtom), folder.id),
                "group",
              );
            })}
            onPointerDown={(event) => {
              // A Cmd-press opens the bookmarks, and the menu, which opens
              // as the pointer goes down, stays shut.
              if (commandKeyHeld(event)) {
                event.preventDefault();
              }
              pressFolder(event, folder, items);
            }}
            onPointerEnter={onHover}
            title={folder.title}
          >
            <FolderSimpleIcon className="size-3.5 shrink-0 text-foreground/60" />
            <span className="min-w-0 truncate">{folder.title}</span>
          </DropdownMenuTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            if (renaming.current) {
              renaming.current = false;
              event.preventDefault();
              onRename();
            }
          }}
        >
          <OpenAllItems of={folder.id} />
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              renaming.current = true;
            }}
          >
            <PencilSimpleIcon className="size-4" />
            <span>Rename…</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              edits.remove(folder);
            }}
          >
            <XCircleIcon className="size-4" />
            <span>Delete</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <NewFolderItem onSelect={onNewFolder} />
          <ManageBookmarksItem />
          <ContextMenuSeparator />
          <ShowBookmarksBarItem />
        </ContextMenuContent>
      </ContextMenu>
      <FolderMenuContent folder={folder.id} items={items} open={open} />
    </DropdownMenu>
  );
}

/**
 * An open folder's menu: each bookmark in it opens as one on the bar does
 * (`bookmarkClicks`), Cmd-click included, can be dragged out onto the bar,
 * anywhere else a bookmark goes, or to another place in the menu, and has
 * the bar's menu for a bookmark on a right click.
 */
function FolderMenuContent({
  folder,
  items,
  open,
}: {
  folder: string;
  items: readonly Bookmark[];
  open: OpenAddress;
}) {
  return (
    <BookmarksMenuContent
      align="start"
      items={items.map((bookmark) => ({ bookmark, kind: "bookmark" }))}
      open={open}
      place={{ folder }}
    />
  );
}

/** Where a menu's items are kept: in a folder, or loose in a root, the bar without either. */
type MenuPlace = { folder?: string; root?: BookmarkRoot };

/**
 * A menu of bookmarks, a folder's, All Bookmarks' or the chevron's over the
 * bar's end: each bookmark a `BookmarkMenuItem` and each folder a submenu
 * (`OverflowFolder`). What is held lands in it where the pointer is
 * (`useMenuTarget`), a line showing where, and in a folder whose row it is
 * on the middle of. A submenu takes the place of the menu it is in.
 */
function BookmarksMenuContent({
  align,
  isSub = false,
  items,
  open,
  place,
}: {
  align?: "end" | "start";
  isSub?: boolean;
  items: readonly BarItem[];
  open: OpenAddress;
  place: MenuPlace;
}) {
  const content = useRef<HTMLDivElement>(null);
  useMenuTarget({ content: () => content.current, place });
  const line = useMenuDropLine(
    place,
    items.map((item) =>
      item.kind === "folder" ? item.folder.id : item.bookmark.id,
    ),
  );
  const drag = useAtomValue(dragAtom);
  const landing =
    drag?.landing?.kind === "bookmarks" ? drag.landing : undefined;
  const intoFolder = landing?.folder;
  // Where something held is over this menu's own rows: among them, or into
  // one of its folders.
  const isOnRows =
    landing !== undefined &&
    landing.chip === undefined &&
    ((landing.folder === place.folder && landing.root === place.root) ||
      items.some(
        (item) => item.kind === "folder" && item.folder.id === landing.folder,
      ));
  const body =
    items.length === 0 ? (
      <DropdownMenuItem disabled>
        <span className="text-muted-foreground">Empty</span>
      </DropdownMenuItem>
    ) : (
      items.map((item) =>
        item.kind === "folder" ? (
          <OverflowFolder
            folder={item.folder}
            isElsewhere={isOnRows && intoFolder !== item.folder.id}
            isLit={intoFolder === item.folder.id}
            items={item.items}
            key={item.folder.id}
            line={line?.before === item.folder.id}
            open={open}
          />
        ) : (
          <BookmarkMenuItem
            bookmark={item.bookmark}
            isHeld={line?.held.has(item.bookmark.id) === true}
            key={item.bookmark.id}
            line={line?.before === item.bookmark.id}
            open={open}
          />
        ),
      )
    );
  const end = line?.before === "end" && <DropLine />;
  // A press on a bookmark in the menu may become a drag, which keeps the
  // menu up until it lands.
  const keepFocus = (event: Event) => {
    event.preventDefault();
  };
  return isSub ? (
    <DropdownMenuSubContent className="max-w-72 min-w-48" ref={content}>
      {body}
      {end}
    </DropdownMenuSubContent>
  ) : (
    <DropdownMenuContent
      align={align}
      className="max-w-72 min-w-48"
      onCloseAutoFocus={keepFocus}
      ref={content}
    >
      {body}
      {end}
    </DropdownMenuContent>
  );
}

/**
 * A bookmark in a menu of the bar's: it opens as one on the bar does
 * (`bookmarkClicks`), drags as one does (`pressBookmark`), and has the
 * bar's menu for a bookmark on a right click.
 */
function BookmarkMenuItem({
  bookmark,
  isHeld,
  line,
  open,
}: {
  bookmark: Bookmark;
  /** Being dragged, which leaves it in its place, faded. */
  isHeld: boolean;
  /** Something held would land just above it. */
  line: boolean;
  open: OpenAddress;
}) {
  return (
    <BookmarkContextMenu bookmark={bookmark} open={open}>
      <DropdownMenuItem
        {...bookmarkClicks(bookmark.url, open)}
        className={cn("relative", isHeld && "opacity-50")}
        data-bookmark-id={bookmark.id}
        onPointerDown={(event) => {
          pressBookmark(event, bookmark);
        }}
        title={bookmark.url}
      >
        {line && <DropLine isAbove />}
        <AddressMark address={bookmark.url} />
        <span className="min-w-0 truncate">{bookmarkName(bookmark)}</span>
      </DropdownMenuItem>
    </BookmarkContextMenu>
  );
}

/** Where something held over a folder's menu would be filed: above an item, or at the menu's end. */
function DropLine({ isAbove = false }: { isAbove?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none mx-2 block h-0.5 rounded-full bg-primary",
        isAbove && "absolute inset-x-0 -top-px",
      )}
    />
  );
}

/**
 * Naming something of the bookmarks in a dialog: a new folder, a folder on
 * the Bookmarks page, or the folder Bookmark All Tabs makes. An empty or
 * unchanged name changes nothing.
 */
export function BookmarkNameDialog({
  action,
  name,
  onClose,
  onCommit,
  title,
}: {
  action: string;
  name: string;
  onClose: () => void;
  onCommit: (name: string) => void;
  title: string;
}) {
  const [value, setValue] = useState(name);
  return (
    <Dialog
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
      open
    >
      <DialogContent maxWidth="24rem" showCloseButton={false}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onCommit(value);
            onClose();
          }}
        >
          <DialogTitle>{title}</DialogTitle>
          <Input
            aria-label="Name"
            autoFocus
            onChange={(event) => {
              setValue(event.target.value);
            }}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            placeholder="Name"
            value={value}
          />
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={!value.trim()} type="submit">
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A folder in a menu of the bar's, past the bar's end under the chevron or
 * in All Bookmarks: a submenu of the bookmarks in it, with Open All on a
 * right click. Something held on the middle of its row is lit, and resting
 * there opens it, as a folder's chip on the bar does, to be filed at a
 * place in it; it stays open until what is held is on another row of the
 * menu it is in, or lands.
 */
function OverflowFolder({
  folder,
  isElsewhere = false,
  isLit = false,
  items,
  line = false,
  open,
}: {
  folder: BookmarkFolder;
  /** Something held is on another row of the menu it is in. */
  isElsewhere?: boolean;
  /** Something held would be filed in it if let go now. */
  isLit?: boolean;
  items: readonly Bookmark[];
  /** Something held would land just above it. */
  line?: boolean;
  open: OpenAddress;
}) {
  const [isOpen, setOpen] = useState(false);
  const isSprung = useSpringOpen(isLit, isElsewhere);
  return (
    <DropdownMenuSub onOpenChange={setOpen} open={isOpen || isSprung}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <DropdownMenuSubTrigger
            className={cn("relative", isLit && "bg-accent")}
            data-bookmark-folder={folder.id}
            data-bookmark-id={folder.id}
          >
            {line && <DropLine isAbove />}
            <FolderSimpleIcon className="size-4" />
            <span className="min-w-0 truncate">{folder.title}</span>
          </DropdownMenuSubTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <OpenAllItems of={folder.id} />
        </ContextMenuContent>
      </ContextMenu>
      <BookmarksMenuContent
        isSub
        items={items.map((bookmark) => ({ bookmark, kind: "bookmark" }))}
        open={open}
        place={{ folder: folder.id }}
      />
    </DropdownMenuSub>
  );
}

/**
 * The chevron at the bar's right, over the bookmarks and folders past the
 * row's end: a press opens a menu of them, each as it is in All Bookmarks'
 * menu, and while a folder's menu is open, moving onto it opens this one
 * instead (`onHover`). Something held over it is lit, and letting go there
 * keeps it at the bar's end (`useBookmarksTarget`).
 */
export function OverflowChip({
  isLit,
  isOpen,
  items,
  onHover,
  onOpenChange,
  open,
}: {
  /** Something held would be kept at the bar's end if let go now. */
  isLit: boolean;
  isOpen: boolean;
  /** The bar's items past the row's end, in order. */
  items: readonly BarItem[];
  onHover: () => void;
  onOpenChange: (open: boolean) => void;
  open: OpenAddress;
}) {
  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange} open={isOpen}>
      <DropdownMenuTrigger
        aria-label="More bookmarks"
        className={cn(
          "grid size-6 shrink-0 cursor-default place-items-center rounded-md text-foreground/60 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8",
          isLit && DROP_TONE,
        )}
        data-bookmarks-overflow=""
        onPointerEnter={onHover}
      >
        <CaretDoubleRightIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <BookmarksMenuContent align="end" items={items} open={open} place={{}} />
    </DropdownMenu>
  );
}

/**
 * All Bookmarks at the bar's right end, as Chrome has it: a press opens a
 * menu of its bookmarks and folders in order, a folder a submenu of the
 * bookmarks filed in it and a bookmark opening as one on the bar does
 * (`bookmarkClicks`) with the bar's menu for a bookmark on a right click.
 * While a folder's menu is open, moving onto it opens this one instead
 * (`onHover`). A middle click or a Cmd-click opens the bookmarks directly
 * in it (`folderClicks`), and a right click offers that too, the Bookmarks
 * page and the bar's switch. Something held over it is lit, and letting go
 * there keeps it at the end of All Bookmarks (`useBookmarksTarget`).
 */
export function OtherBookmarksChip({
  isLit,
  isOpen,
  items,
  onHover,
  onOpenChange,
  open,
}: {
  /** Something held would be kept in it if let go now. */
  isLit: boolean;
  isOpen: boolean;
  /** Its folders and loose bookmarks, in order (`rootItems`). */
  items: readonly BarItem[];
  onHover: () => void;
  onOpenChange: (open: boolean) => void;
  open: OpenAddress;
}) {
  const store = useStore();
  const openAll = useOpenAllBookmarks();
  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange} open={isOpen}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <DropdownMenuTrigger
            className={cn(
              "flex h-6 max-w-40 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/80 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8",
              isLit && DROP_TONE,
            )}
            data-other-bookmarks=""
            {...folderClicks(() => {
              openAll(
                bookmarksToOpen(store.get(bookmarksStateAtom), OTHER_ROOT),
                "group",
              );
            })}
            onPointerDown={(event) => {
              if (commandKeyHeld(event)) {
                event.preventDefault();
              }
            }}
            onPointerEnter={onHover}
            title={OTHER_ROOT_TITLE}
          >
            <FolderSimpleIcon className="size-3.5 shrink-0 text-foreground/60" />
            <span className="min-w-0 truncate">{OTHER_ROOT_TITLE}</span>
          </DropdownMenuTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <OpenAllItems of={OTHER_ROOT} />
          <ContextMenuSeparator />
          <ManageBookmarksItem />
          <ContextMenuSeparator />
          <ShowBookmarksBarItem />
        </ContextMenuContent>
      </ContextMenu>
      <BookmarksMenuContent
        align="end"
        items={items}
        open={open}
        place={{ root: OTHER_ROOT }}
      />
    </DropdownMenu>
  );
}

/**
 * Whether something held has rested on a folder's row long enough to open
 * it (`SPRING_OPEN_MS`): from then until it is on another row of the same
 * menu (`isElsewhere`) or the drag ends, so the gap between the row and its
 * menu, crossed on the way in, never shuts it.
 */
function useSpringOpen(isOver: boolean, isElsewhere: boolean) {
  const [isSprung, setSprung] = useState(false);
  const isHolding = useAtomValue(dragAtom) !== undefined;
  useEffect(() => {
    if (!isOver) {
      return;
    }
    const timer = setTimeout(() => {
      setSprung(true);
    }, SPRING_OPEN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isOver]);
  if (isSprung && (isElsewhere || !isHolding)) {
    setSprung(false);
  }
  return isSprung && isHolding && !isElsewhere;
}

/**
 * Which folder of the bar has its menu open, one at a time: a press opens a
 * folder's menu or closes it, and while one is open, the pointer coming
 * onto another folder opens that one's instead, as a browser's bar does.
 */
export function useOpenFolder() {
  const [openFolder, setOpenFolder] = useState<string>();
  return {
    /** What a folder's chip takes to open and close with the others. */
    chip: (folder: string) => ({
      isOpen: openFolder === folder,
      onHover: () => {
        setOpenFolder((was) => (was === undefined ? was : folder));
      },
      onOpenChange: (isOpen: boolean) => {
        setOpenFolder((was) =>
          isOpen ? folder : was === folder ? undefined : was,
        );
      },
    }),
    setOpenFolder,
  };
}
