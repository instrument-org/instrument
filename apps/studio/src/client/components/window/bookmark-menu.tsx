import { useBookmarkActions } from "@/client/bookmarks/actions";
import { type OpenHow, openHowOf } from "@/client/bookmarks/open-address";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { type Bookmark, placeOf } from "@/shared/bookmarks";
import { ArrowSquareInIcon } from "@phosphor-icons/react/ArrowSquareIn";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { StarIcon } from "@phosphor-icons/react/Star";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { type MouseEvent, type ReactElement, useRef } from "react";

import { useBookmarkEdits } from "./web-start";

/** The middle button, which asks for a tab of its own. */
const MIDDLE_BUTTON = 1;

/**
 * What a press on a bookmark does, on the bar and in the sidebar alike: a
 * click opens it in this tab, a Cmd-click or a middle click in a new tab
 * behind this one, and a Shift-click as the first tab of a new tab group.
 */
export function bookmarkClicks(
  bookmark: Bookmark,
  open: (address: string, how: OpenHow) => void,
) {
  return {
    onAuxClick: (event: MouseEvent) => {
      if (event.button === MIDDLE_BUTTON) {
        event.preventDefault();
        open(bookmark.url, "newTab");
      }
    },
    onClick: (event: MouseEvent) => {
      open(bookmark.url, openHowOf(event));
    },
    // The middle button's own answer is to scroll; here it opens.
    onMouseDown: (event: MouseEvent) => {
      if (event.button === MIDDLE_BUTTON) {
        event.preventDefault();
      }
    },
  };
}

/**
 * The menu over a bookmark, on the bar and in the sidebar alike: opening it
 * the three ways a press can, renaming it, moving it to the other place
 * bookmarks show, copying its address, and removing it.
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
  open: (address: string, how: OpenHow) => void;
}) {
  const actions = useBookmarkActions();
  const edits = useBookmarkEdits();
  const isOnBar = placeOf(bookmark) === "bar";
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
            open(bookmark.url, "here");
          }}
        >
          <ArrowSquareInIcon className="size-4" />
          <span>Open</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            open(bookmark.url, "newTab");
          }}
        >
          <NewTabIcon className="size-4" />
          <span>Open in New Tab</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            open(bookmark.url, "newGroup");
          }}
        >
          <SquaresFourIcon className="size-4" />
          <span>Open in New Tab Group</span>
        </ContextMenuItem>
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
            actions.place(bookmark, isOnBar ? "sidebar" : "bar");
          }}
        >
          {isOnBar ? (
            <SidebarSimpleIcon className="size-4" />
          ) : (
            <StarIcon className="size-4" />
          )}
          <span>{isOnBar ? "Move to Sidebar" : "Move to Bookmarks Bar"}</span>
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
          <span>Remove from Bookmarks</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
