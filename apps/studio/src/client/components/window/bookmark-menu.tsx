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
import { type OpenOptions } from "@/client/components/window/context";
import {
  openClickGestures,
  useWindowPlaces,
} from "@/client/hooks/use-open-target";
import { rpcClient } from "@/client/rpc/client";
import { useBookmarkFolders } from "@/client/bookmarks/folders";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import { type Bookmark, folderOf } from "@/shared/bookmarks";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { FolderSimplePlusIcon } from "@phosphor-icons/react/FolderSimplePlus";
import { useAtomValue } from "jotai";
import { ArrowSquareInIcon } from "@phosphor-icons/react/ArrowSquareIn";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/BookmarksSimple";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactElement, useRef } from "react";

import { PlaceItems } from "./place-items";
import { useBookmarkEdits } from "./web-start";

/** Whether the bookmarks bar shows, a preference of the workspace's: shown until it says otherwise. */
export function useShowsBookmarksBar() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  return preferences?.showBookmarksBar !== false;
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
      <BookmarksSimpleIcon className="size-4" />
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
 * The menu over a bookmark: opening it here or in a place of the window's
 * own, renaming it, copying its address, deleting it, and the bar's own
 * switch at the end.
 */
export function BookmarkContextMenu({
  bookmark,
  children,
  onNewFolder,
  onRename,
  open,
}: {
  bookmark: Bookmark;
  /** The bookmark's own row, which the menu comes up over. */
  children: ReactElement;
  /** Makes a folder on the bar, offered where one can go beside the bookmark. */
  onNewFolder?: () => void;
  /** Starts naming the bookmark, once the menu has let go of the keyboard. */
  onRename: () => void;
  open: OpenAddress;
}) {
  const edits = useBookmarkEdits();
  const placesOf = useWindowPlaces();
  // A rename asked for is started as the menu closes: a field focused while
  // the menu still holds the keyboard loses it at once.
  const renaming = useRef(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
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
            renaming.current = true;
          }}
        >
          <PencilSimpleIcon className="size-4" />
          <span>Rename</span>
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
        {onNewFolder && (
          <>
            <NewFolderItem onSelect={onNewFolder} />
            <ContextMenuSeparator />
          </>
        )}
        <ShowBookmarksBarItem />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Filing a bookmark in one of the bar's folders, or taking it out onto the
 * bar, from its menu: the way to do it without dragging. None while the bar
 * has no folders.
 */
function MoveToItems({ bookmark }: { bookmark: Bookmark }) {
  const state = useAtomValue(bookmarksStateAtom);
  const folders = useBookmarkFolders();
  const filedIn = folderOf(state, bookmark)?.id;
  const others = state.folders.filter((folder) => folder.id !== filedIn);
  if (others.length === 0 && filedIn === undefined) {
    return null;
  }
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderSimpleIcon className="size-4" />
        <span>Move To</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-w-72 min-w-44">
        {filedIn !== undefined && (
          <ContextMenuItem
            onClick={() => {
              folders.moveTo(bookmark, undefined);
            }}
          >
            <BookmarksSimpleIcon className="size-4" />
            <span>Bookmarks Bar</span>
          </ContextMenuItem>
        )}
        {others.map((folder) => (
          <ContextMenuItem
            key={folder.id}
            onClick={() => {
              folders.moveTo(bookmark, folder.id);
            }}
          >
            <FolderSimpleIcon className="size-4" />
            <span className="min-w-0 truncate">{folder.title}</span>
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
