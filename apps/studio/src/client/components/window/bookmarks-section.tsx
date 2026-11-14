import { useOpenAddress } from "@/client/bookmarks/open-address";
import { bookmarksAtom } from "@/client/bookmarks/store";
import { cn } from "@/client/lib/utils";
import { placeOf } from "@/shared/bookmarks";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { useAtomValue } from "jotai";
import { useState } from "react";

import { AddressMark } from "./app-chip";
import { BookmarkContextMenu, bookmarkClicks } from "./bookmark-menu";
import { bookmarkName, useBookmarkEdits } from "./web-start";
import { useWindowTabs } from "./window-tabs";

/**
 * The bookmarks kept in the sidebar, under the projects, one line each the
 * way a Finder window's favorites are: the mark its tab wears and its name.
 * A click opens one in the tab up, a Cmd-click in a new tab behind it, a
 * Shift-click as a new tab group, and a right click offers the rest. The
 * heading's caret folds them; with none kept here there is no section.
 */
export function BookmarksSection() {
  const bookmarks = useAtomValue(bookmarksAtom).filter(
    (bookmark) => placeOf(bookmark) === "sidebar",
  );
  const { active, visitHref } = useWindowTabs();
  const open = useOpenAddress(
    active
      ? {
          screen: (href) => {
            visitHref(active.id, href);
          },
        }
      : {},
  );
  const edits = useBookmarkEdits();
  const [isOpen, setOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string>();
  if (bookmarks.length === 0) {
    return null;
  }
  return (
    <section aria-label="Bookmarks" className="pb-2">
      <div className="flex h-8 items-center pr-1 pl-2.5">
        <button
          aria-expanded={isOpen}
          className="flex h-6 items-center gap-1 rounded-md pr-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(!isOpen);
          }}
          type="button"
        >
          Bookmarks
          <CaretDownIcon
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              !isOpen && "-rotate-90",
            )}
            weight="bold"
          />
        </button>
      </div>
      {isOpen && (
        <ul className="flex flex-col">
          {bookmarks.map((bookmark) => {
            const name = bookmarkName(bookmark);
            const mark = (
              <span className="grid size-4 shrink-0 place-items-center">
                <AddressMark address={bookmark.url} />
              </span>
            );
            if (bookmark.id === renamingId) {
              return (
                <li
                  className="flex h-7 items-center gap-2 px-2.5"
                  key={bookmark.id}
                >
                  {mark}
                  <input
                    aria-label="Bookmark name"
                    autoFocus
                    className="h-6 min-w-0 flex-1 rounded-md border border-ring bg-background px-1.5 text-sm outline-none"
                    defaultValue={name}
                    onBlur={(event) => {
                      setRenamingId(undefined);
                      edits.rename(bookmark, event.currentTarget.value);
                    }}
                    onFocus={(event) => {
                      event.currentTarget.select();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        event.currentTarget.value = name;
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </li>
              );
            }
            return (
              <li key={bookmark.id}>
                <BookmarkContextMenu
                  bookmark={bookmark}
                  onRename={() => {
                    setRenamingId(bookmark.id);
                  }}
                  open={open}
                >
                  <button
                    className="flex h-7 w-full cursor-default items-center gap-2 rounded-lg px-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/5"
                    {...bookmarkClicks(bookmark, open)}
                    title={`${name}\n${bookmark.url}`}
                    type="button"
                  >
                    {mark}
                    <span className="min-w-0 truncate">{name}</span>
                  </button>
                </BookmarkContextMenu>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
