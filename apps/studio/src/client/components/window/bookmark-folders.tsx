import { useBookmarkFolders } from "@/client/bookmarks/folders";
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
import { cn } from "@/client/lib/utils";
import {
  type BarItem,
  type Bookmark,
  type BookmarkFolder,
  OTHER_ROOT_TITLE,
} from "@/shared/bookmarks";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { useRef, useState } from "react";

import { AddressMark } from "./app-chip";
import {
  BookmarkContextMenu,
  ManageBookmarksItem,
  NewFolderItem,
  type OpenAddress,
  ShowBookmarksBarItem,
  bookmarkClicks,
} from "./bookmark-menu";
import { DROP_TONE } from "./drag/tone";
import { pressBookmark, pressFolder } from "./drag/press-bookmark";
import {
  useFolderDropLine,
  useFolderMenuTarget,
} from "./drag/use-bookmarks-drag";
import { bookmarkName } from "./web-start";

/**
 * A folder on the bookmarks bar, as a browser's bar has them: a press opens
 * a menu of the bookmarks in it, and while one folder's menu is open,
 * moving onto another folder opens that one's instead (`onHover`). A right
 * click offers to rename it, delete it, or make another folder. While
 * something is held over its middle it is lit, and letting go there files
 * it in the folder (`useBookmarksTarget`).
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
  /** Starts naming the folder in its place, once the menu has let go of the keyboard. */
  onRename: () => void;
  open: OpenAddress;
}) {
  const edits = useBookmarkFolders();
  const renaming = useRef(false);
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
            onPointerDown={(event) => {
              pressFolder(event, folder);
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
          <ContextMenuItem
            onClick={() => {
              renaming.current = true;
            }}
          >
            <PencilSimpleIcon className="size-4" />
            <span>Rename</span>
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
  const content = useRef<HTMLDivElement>(null);
  useFolderMenuTarget({ content: () => content.current, folder });
  const line = useFolderDropLine(folder, items);
  return (
    <DropdownMenuContent
      align="start"
      className="max-w-72 min-w-48"
      // A press on a bookmark in the menu may become a drag, which keeps
      // the menu up until it lands.
      onCloseAutoFocus={(event) => {
        event.preventDefault();
      }}
      ref={content}
    >
      {items.length === 0 ? (
        <DropdownMenuItem disabled>
          <span className="text-muted-foreground">Empty</span>
        </DropdownMenuItem>
      ) : (
        <FolderItems items={items} line={line} open={open} />
      )}
      {line?.before === "end" && <DropLine />}
    </DropdownMenuContent>
  );
}

function FolderItems({
  items,
  line,
  open,
}: {
  items: readonly Bookmark[];
  line: ReturnType<typeof useFolderDropLine>;
  open: OpenAddress;
}) {
  return items.map((bookmark) => (
    <BookmarkContextMenu bookmark={bookmark} key={bookmark.id} open={open}>
      <DropdownMenuItem
        {...bookmarkClicks(bookmark.url, open)}
        className={cn("relative", line?.held.has(bookmark.id) && "opacity-50")}
        data-bookmark-id={bookmark.id}
        onPointerDown={(event) => {
          pressBookmark(event, bookmark);
        }}
        title={bookmark.url}
      >
        {line?.before === bookmark.id && <DropLine isAbove />}
        <AddressMark address={bookmark.url} />
        <span className="min-w-0 truncate">{bookmarkName(bookmark)}</span>
      </DropdownMenuItem>
    </BookmarkContextMenu>
  ));
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

/** A folder past the bar's end, in the menu under the chevron: a submenu of the bookmarks in it. */
export function OverflowFolder({
  folder,
  items,
  open,
}: {
  folder: BookmarkFolder;
  items: readonly Bookmark[];
  open: OpenAddress;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderSimpleIcon className="size-4" />
        <span className="min-w-0 truncate">{folder.title}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-w-72 min-w-48">
        {items.length === 0 ? (
          <DropdownMenuItem disabled>
            <span className="text-muted-foreground">Empty</span>
          </DropdownMenuItem>
        ) : (
          items.map((bookmark) => (
            <DropdownMenuItem
              key={bookmark.id}
              {...bookmarkClicks(bookmark.url, open)}
              title={bookmark.url}
            >
              <AddressMark address={bookmark.url} />
              <span className="min-w-0 truncate">{bookmarkName(bookmark)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * All Bookmarks at the bar's right end, as Chrome has it: a press opens a
 * menu of its bookmarks and folders in order, a folder a submenu of the
 * bookmarks filed in it and a bookmark opening as one on the bar does
 * (`bookmarkClicks`) with the bar's menu for a bookmark on a right click.
 * While a folder's menu is open, moving onto it opens this one instead
 * (`onHover`). A right click on it offers the Bookmarks page and the bar's
 * switch.
 */
export function OtherBookmarksChip({
  isOpen,
  items,
  onHover,
  onOpenChange,
  open,
}: {
  isOpen: boolean;
  /** Its folders and loose bookmarks, in order (`rootItems`). */
  items: readonly BarItem[];
  onHover: () => void;
  onOpenChange: (open: boolean) => void;
  open: OpenAddress;
}) {
  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange} open={isOpen}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <DropdownMenuTrigger
            className="flex h-6 max-w-40 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/80 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8"
            data-other-bookmarks=""
            onPointerEnter={onHover}
            title={OTHER_ROOT_TITLE}
          >
            <FolderSimpleIcon className="size-3.5 shrink-0 text-foreground/60" />
            <span className="min-w-0 truncate">{OTHER_ROOT_TITLE}</span>
          </DropdownMenuTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <ManageBookmarksItem />
          <ContextMenuSeparator />
          <ShowBookmarksBarItem />
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenuContent align="end" className="max-w-72 min-w-48">
        {items.map((item) =>
          item.kind === "folder" ? (
            <OverflowFolder
              folder={item.folder}
              items={item.items}
              key={item.folder.id}
              open={open}
            />
          ) : (
            <BookmarkContextMenu
              bookmark={item.bookmark}
              key={item.bookmark.id}
              open={open}
            >
              <DropdownMenuItem
                {...bookmarkClicks(item.bookmark.url, open)}
                title={item.bookmark.url}
              >
                <AddressMark address={item.bookmark.url} />
                <span className="min-w-0 truncate">
                  {bookmarkName(item.bookmark)}
                </span>
              </DropdownMenuItem>
            </BookmarkContextMenu>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
