import { openBuiltInPage } from "@/client/atoms/page-requests";
import { useOpenAddress } from "@/client/bookmarks/open-address";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { rpcClient } from "@/client/rpc/client";
import { barItems, type Bookmark } from "@/shared/bookmarks";
import { SCREENS } from "@/shared/instrument-screens";
import {
  WINDOW_SHORTCUTS,
  type WindowShortcutId,
} from "@/shared/window-shortcuts";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/BookmarkSimple";
import { BookmarksIcon } from "@phosphor-icons/react/Bookmarks";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { StarIcon } from "@phosphor-icons/react/Star";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { AddressMark } from "./app-chip";
import { requestBookmarkAllTabs } from "./bookmark-all-tabs";
import { useShowsBookmarksBar } from "./bookmark-menu";
import { requestBookmarkTab } from "./bookmark-star";
import { bookmarkName } from "./web-start";

/**
 * The browser's ⋮ Bookmarks, under History as in Chrome: bookmarking the
 * tab (its star's card) or every tab of the group, the bar's switch, the
 * Bookmarks page, and then the bar itself, each folder a submenu, so every
 * bookmark is one menu away with the bar hidden. A bookmark opens in this
 * tab, a site by `onOpenPage`.
 */
export function BookmarksSubmenu({
  canBookmark,
  onOpenPage,
}: {
  /** Whether the tab has an address to keep. */
  canBookmark: boolean;
  onOpenPage: (url: string) => void;
}) {
  const state = useAtomValue(bookmarksStateAtom);
  const items = barItems(state);
  const isBarShown = useShowsBookmarksBar();
  const setBarShown = useMutation(
    rpcClient.preferences.setShowBookmarksBar.mutationOptions(),
  );
  const open = useOpenAddress({ loadHere: onOpenPage });
  const shortcut = (name: WindowShortcutId) => (
    <DropdownMenuShortcut>
      {formatAcceleratorText(WINDOW_SHORTCUTS[name].accelerator)}
    </DropdownMenuShortcut>
  );
  // A card or a dialog opened while the menu still holds the keyboard loses
  // it as the menu closes, so each waits for the menu to go first.
  const afterMenu = (run: () => void) => () => {
    setTimeout(run, 0);
  };
  const bookmarkItem = (bookmark: Bookmark) => (
    <DropdownMenuItem
      key={bookmark.id}
      onSelect={() => {
        open(bookmark.url);
      }}
      title={bookmark.url}
    >
      <AddressMark address={bookmark.url} />
      <span className="min-w-0 truncate">{bookmarkName(bookmark)}</span>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <BookmarkSimpleIcon className="size-4" />
        Bookmarks
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-w-80 min-w-60">
        <DropdownMenuItem
          disabled={!canBookmark}
          onSelect={afterMenu(requestBookmarkTab)}
        >
          <StarIcon className="size-4" />
          Bookmark this tab…
          {shortcut("bookmarkTab")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={afterMenu(requestBookmarkAllTabs)}>
          <span className="size-4" />
          Bookmark all tabs…
          {shortcut("bookmarkAllTabs")}
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={isBarShown}
          onCheckedChange={(enabled) => {
            setBarShown.mutate({ enabled });
          }}
        >
          Show bookmarks bar
          {shortcut("toggleBookmarksBar")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          onSelect={() => {
            openBuiltInPage(SCREENS.bookmarks.href);
          }}
        >
          <BookmarksIcon className="size-4" />
          Bookmark manager
          {shortcut("showBookmarks")}
        </DropdownMenuItem>
        {items.length > 0 && <DropdownMenuSeparator />}
        {items.map((item) =>
          item.kind === "bookmark" ? (
            bookmarkItem(item.bookmark)
          ) : (
            <DropdownMenuSub key={item.folder.id}>
              <DropdownMenuSubTrigger>
                <FolderSimpleIcon className="size-4" />
                <span className="min-w-0 truncate">{item.folder.title}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-80 min-w-52">
                {item.items.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <span className="text-muted-foreground">Empty</span>
                  </DropdownMenuItem>
                ) : (
                  <>
                    {item.items.map(bookmarkItem)}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        item.items.forEach((bookmark, index) => {
                          open(bookmark.url, {
                            behind: index > 0,
                            newTab: true,
                          });
                        });
                      }}
                    >
                      <span className="size-4" />
                      Open all in new tabs
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ),
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
