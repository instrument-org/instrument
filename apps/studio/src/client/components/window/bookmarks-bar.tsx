import { bookmarksAtom } from "@/client/bookmarks/store";
import { PageFavicon } from "@/client/components/favicon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { noteTypedPage } from "@/client/hooks/use-browser-history";
import { cn } from "@/client/lib/utils";
import { type Bookmark } from "@/shared/bookmarks";
import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/CaretDoubleRight";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { useAtomValue } from "jotai";
import { useLayoutEffect, useRef, useState } from "react";

import { PageContextMenu, usePageClicks } from "./page-menu";
import { BookmarkNameField, bookmarkName, useBookmarkEdits } from "./web-start";

/**
 * Whether a tab shows the bookmarks bar: the new tab always, where it says
 * how a bookmark gets there while there are none, and a page while there
 * are some.
 */
export function useHasBookmarksBar(isNewTab: boolean): boolean {
  const bookmarks = useAtomValue(bookmarksAtom);
  return isNewTab || bookmarks.length > 0;
}

/**
 * The bookmarks in a row under a tab's toolbar, each its site's favicon and
 * a short name, the way a browser's bookmarks bar keeps them, after Files
 * where the row is given it (`onFiles`). Those past the row's end are under
 * a chevron at its right. A click opens one in this tab (`onOpen`), a
 * Cmd-click or a middle click in a tab of its own behind this one, and a
 * right click offers to rename it or remove it.
 */
export function BookmarksBar({
  onFiles,
  onOpen,
}: {
  onFiles?: () => void;
  onOpen: (url: string) => void;
}) {
  const bookmarks = useAtomValue(bookmarksAtom);
  const clicksFor = usePageClicks();
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
  // A bookmark is an address the person chose, so opening one counts the
  // way typing it would.
  const open = (url: string) => {
    noteTypedPage(url);
    onOpen(url);
  };
  const overflow = bookmarks.slice(fitting);

  return (
    <div
      aria-label="Bookmarks"
      className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-1.5"
      role="toolbar"
    >
      {onFiles && (
        <>
          <button
            className="flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/80 hover:bg-foreground/8 hover:text-foreground"
            onClick={onFiles}
            type="button"
          >
            <FileSystemFolderGlyph className="h-3 w-auto" />
            Files
          </button>
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
                  <BookmarkFavicon bookmark={bookmark} />
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
              <PageContextMenu
                key={bookmark.id}
                onOpen={open}
                onRemove={() => {
                  edits.remove(bookmark);
                }}
                onRename={() => {
                  setRenamingId(bookmark.id);
                }}
                removeLabel="Remove from Bookmarks"
                url={bookmark.url}
              >
                <button
                  {...(isOver ? { "aria-hidden": true, tabIndex: -1 } : {})}
                  className={cn(
                    "flex h-6 max-w-40 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 text-xs text-foreground/80 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8",
                    isOver && "invisible",
                  )}
                  {...clicksFor(bookmark.url, open)}
                  title={`${name}\n${bookmark.url}`}
                  type="button"
                >
                  <BookmarkFavicon bookmark={bookmark} />
                  <span className="min-w-0 truncate">{name}</span>
                </button>
              </PageContextMenu>
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
                {...clicksFor(bookmark.url, open)}
                title={bookmark.url}
              >
                <BookmarkFavicon bookmark={bookmark} />
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

function BookmarkFavicon({ bookmark }: { bookmark: Bookmark }) {
  return (
    <PageFavicon className="size-3.5" hasTooltip={false} url={bookmark.url} />
  );
}

/** The bar before there are bookmarks: where they come from, in the words of the page menu that adds them. */
function NoBookmarks() {
  return (
    <p className="flex min-w-0 items-center gap-1 truncate px-1.5 text-xs text-muted-foreground">
      Choose
      <span className="font-medium text-foreground/70">Add to bookmarks</span>
      from the
      <DotsThreeVerticalIcon
        aria-label="page"
        className="size-3.5 shrink-0 text-foreground/70"
        weight="bold"
      />
      menu on a website to add bookmarks
    </p>
  );
}
