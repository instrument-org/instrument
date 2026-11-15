import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { contextMenuComponents } from "@/client/components/ui/menu-components";
import { type OpenOptions } from "@/client/components/window/context";
import {
  openClickGestures,
  useWindowPlaces,
} from "@/client/hooks/use-open-target";
import { rpcClient } from "@/client/rpc/client";
import { type Bookmark } from "@/shared/bookmarks";
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
  onRename,
  open,
}: {
  bookmark: Bookmark;
  /** The bookmark's own row, which the menu comes up over. */
  children: ReactElement;
  /** Starts naming the bookmark in its row, once the menu has let go of the keyboard. */
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
        <ShowBookmarksBarItem />
      </ContextMenuContent>
    </ContextMenu>
  );
}
