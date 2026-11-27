import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { contextMenuComponents } from "@/client/components/ui/menu-components";
import { openBuiltInPage } from "@/client/atoms/page-requests";
import { type OpenOptions } from "@/client/components/window/context";
import { SCREENS } from "@/shared/instrument-screens";
import { BookmarksIcon } from "@phosphor-icons/react/Bookmarks";
import {
  openClickGestures,
  useWindowPlaces,
} from "@/client/hooks/use-open-target";
import { rpcClient } from "@/client/rpc/client";
import { useBookmarkFolders } from "@/client/bookmarks/folders";
import {
  bookmarksToOpen,
  useOpenAllBookmarks,
} from "@/client/bookmarks/open-address";
import { commandKeyHeld } from "@/client/lib/utils";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import {
  type Bookmark,
  bookmarkPlaces,
  keyOfPlace,
  placeOf,
} from "@/shared/bookmarks";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { FolderSimplePlusIcon } from "@phosphor-icons/react/FolderSimplePlus";
import { useAtomValue } from "jotai";
import { ArrowSquareInIcon } from "@phosphor-icons/react/ArrowSquareIn";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactElement, useRef, useState } from "react";

import { BookmarkEditor, PlaceIndent } from "./bookmark-editor";
import { PlaceItems } from "./place-items";
import { useBookmarkEdits } from "./bookmark-edits";

/** Whether the bookmarks bar shows beyond a new tab, a preference of the workspace's: only once it is turned on. */
export function useShowsBookmarksBar() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  return preferences?.showBookmarksBar === true;
}

/**
 * The bookmarks bar's own switch, ticked while it shows: the whole of the
 * bar's menu, and the last of a bookmark's, as a browser has it.
 */
export function ShowBookmarksBarItem() {
  const isShown = useShowsBookmarksBar();
  const setShown = useMutation(
    rpcClient.preferences.setShowBookmarksBar.mutationOptions(),
  );
  return (
    <ContextMenuCheckboxItem
      checked={isShown}
      onCheckedChange={(enabled) => {
        setShown.mutate({ enabled });
      }}
    >
      <BookmarksIcon className="size-4" />
      <span>Show Bookmarks Bar</span>
    </ContextMenuCheckboxItem>
  );
}

/** Opens an address: in this tab with no options, else where the options place it. */
export type OpenAddress = (address: string, asked?: OpenOptions) => void;

/**
 * What a press on a bookmark, or any mark on the bookmarks bar, does, as on
 * any link the app draws (`openClickGestures`): a click opens it in this
 * tab, whatever it names, a Cmd-click or a middle click in a new tab behind
 * this one, and a Shift-click in a new tab in front, as the menu's Open in
 * New Tab does.
 */
export function bookmarkClicks(address: string, open: OpenAddress) {
  return openClickGestures({
    open: () => {
      open(address);
    },
    openInFront: () => {
      open(address, { newTab: true });
    },
    openInNewTab: () => {
      open(address, { behind: true, newTab: true });
    },
  });
}

/**
 * The menu over a bookmark, in a browser's order: opening it here or in a
 * place of the window's own, Edit… (the editor, `BookmarkEditor`), copying
 * its address, filing it, deleting it, and then the bar's own: a new folder,
 * the Bookmarks page and the bar's switch.
 */
export function BookmarkContextMenu({
  bookmark,
  children,
  onNewFolder,
  open,
}: {
  bookmark: Bookmark;
  /** The bookmark's own row, which the menu comes up over. */
  children: ReactElement;
  /** Makes a folder on the bar, offered where one can go beside the bookmark. */
  onNewFolder?: () => void;
  open: OpenAddress;
}) {
  const edits = useBookmarkEdits();
  const placesOf = useWindowPlaces();
  const [isEditing, setEditing] = useState(false);
  // The editor asked for is opened as the menu closes: a dialog opened
  // while the menu still holds the keyboard loses it at once.
  const editing = useRef(false);
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            if (editing.current) {
              editing.current = false;
              event.preventDefault();
              setEditing(true);
            }
          }}
        >
          <ContextMenuItem
            onClick={() => {
              open(bookmark.url);
            }}
          >
            <ArrowSquareInIcon className="size-4" />
            <span>Open</span>
          </ContextMenuItem>
          <PlaceItems
            components={contextMenuComponents}
            destinations={placesOf((options) => {
              open(bookmark.url, options);
            })}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              editing.current = true;
            }}
          >
            <PencilSimpleIcon className="size-4" />
            <span>Edit…</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              void navigator.clipboard.writeText(bookmark.url);
            }}
          >
            <CopyIcon className="size-4" />
            <span>Copy Address</span>
          </ContextMenuItem>
          <MoveToItems bookmark={bookmark} />
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              edits.remove(bookmark);
            }}
          >
            <XCircleIcon className="size-4" />
            <span>Delete</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          {onNewFolder && <NewFolderItem onSelect={onNewFolder} />}
          <ManageBookmarksItem />
          <ContextMenuSeparator />
          <ShowBookmarksBarItem />
        </ContextMenuContent>
      </ContextMenu>
      {isEditing && (
        <BookmarkEditor
          bookmark={bookmark}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

/** The Bookmarks page, from any of the bar's menus, as a browser's Bookmark Manager. */
export function ManageBookmarksItem() {
  return (
    <ContextMenuItem
      onClick={() => {
        openBuiltInPage(SCREENS.bookmarks.href);
      }}
    >
      <BookmarksIcon className="size-4" />
      <span>Manage Bookmarks…</span>
    </ContextMenuItem>
  );
}

/**
 * Filing a bookmark in a folder, or loose in the bar or All Bookmarks,
 * from its menu: the way to do it without dragging. Every place but the
 * one it is in (`bookmarkPlaces`).
 */
function MoveToItems({ bookmark }: { bookmark: Bookmark }) {
  const state = useAtomValue(bookmarksStateAtom);
  const folders = useBookmarkFolders();
  const filedIn = keyOfPlace(placeOf(state, bookmark));
  const others = bookmarkPlaces(state).filter((place) => place.key !== filedIn);
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderSimpleIcon className="size-4" />
        <span>Move To</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-w-72 min-w-44">
        {others.map((place) => (
          <ContextMenuItem
            key={place.key ?? "bar"}
            onClick={() => {
              folders.moveTo(bookmark, place.key);
            }}
          >
            {place.depth > 1 && <PlaceIndent depth={place.depth} />}
            {place.depth === 0 ? (
              <BookmarksIcon className="size-4" />
            ) : (
              <FolderSimpleIcon className="size-4" />
            )}
            <span className="min-w-0 truncate">{place.title}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Making a folder on the bar, from any of the bar's menus. */
export function NewFolderItem({ onSelect }: { onSelect: () => void }) {
  return (
    <ContextMenuItem onClick={onSelect}>
      <FolderSimplePlusIcon className="size-4" />
      <span>New Folder…</span>
    </ContextMenuItem>
  );
}

/**
 * A folder's Open All (N) and Open All in New Window, by the folder's id or
 * All Bookmarks' (`bookmarksToOpen`): its bookmarks as one new tab group,
 * up here or as a window of its own. Both are off for a folder with no
 * bookmark directly in it.
 */
export function OpenAllItems({ of }: { of: string }) {
  const state = useAtomValue(bookmarksStateAtom);
  const openAll = useOpenAllBookmarks();
  const bookmarks = bookmarksToOpen(state, of);
  const count = bookmarks.length;
  return (
    <>
      <ContextMenuItem
        disabled={count === 0}
        onClick={() => {
          openAll(bookmarks, "group");
        }}
      >
        <span className="size-4" />
        <span>
          {count === 0 ? "Open All" : `Open All (${count.toString()})`}
        </span>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={count === 0}
        onClick={() => {
          openAll(bookmarks, "window");
        }}
      >
        <span className="size-4" />
        <span>Open All in New Window</span>
      </ContextMenuItem>
    </>
  );
}

const MIDDLE_BUTTON = 1;

/**
 * What a press on a folder of the bar does beyond opening its menu, as in
 * Chrome: a middle click or a Cmd-click opens every bookmark directly in it
 * (`openAll`). The folder keeps its menu shut on a Cmd-press itself, where
 * the menu opens on the pointer going down.
 */
export function folderClicks(openAll: () => void) {
  return {
    onAuxClick: (event: React.MouseEvent) => {
      if (event.button !== MIDDLE_BUTTON) {
        return;
      }
      event.preventDefault();
      openAll();
    },
    onClick: (event: React.MouseEvent) => {
      if (commandKeyHeld(event)) {
        event.preventDefault();
        openAll();
      }
    },
    /** The middle button's own answer, scrolling, kept from starting. */
    onMouseDown: (event: React.MouseEvent) => {
      if (event.button === MIDDLE_BUTTON) {
        event.preventDefault();
      }
    },
  };
}
