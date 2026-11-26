import { UNDO_LABEL } from "@/client/lib/undo-toast";
import { targetOfAddress } from "@/client/bookmarks/address";
import { useBookmarkFolders } from "@/client/bookmarks/folders";
import {
  bookmarksToOpen,
  useOpenAddress,
  useOpenAllBookmarks,
} from "@/client/bookmarks/open-address";
import {
  type ClipItem,
  clipOf,
  NOTHING_SELECTED,
  type OutlineRow,
  outlineRows,
  pasteOps,
  pastePlace,
  restoreOps,
  type Selection,
  selectionAfterClick,
  sortByNameOps,
  topmostPicked,
} from "@/client/bookmarks/outline";
import {
  applyBookmarkOpsAtom,
  bookmarksStateAtom,
} from "@/client/bookmarks/store";
import { Button } from "@/client/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { AddressMark } from "@/client/components/window/app-chip";
import { BookmarkEditor } from "@/client/components/window/bookmark-editor";
import { BookmarkNameDialog } from "@/client/components/window/bookmark-folders";
import {
  pressBookmark,
  pressRows,
} from "@/client/components/window/drag/press-bookmark";
import { DROP_TONE } from "@/client/components/window/drag/tone";
import {
  useOutlineDrop,
  useOutlineTarget,
} from "@/client/components/window/drag/use-bookmarks-drag";
import { bareAddress } from "@/client/components/window/omnibar-match";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { SearchField } from "@/client/components/window/search-field";
import { bookmarkName } from "@/client/components/window/web-start";
import { matchScreen } from "@/client/components/window/window-href";
import { useWindowPlaces } from "@/client/hooks/use-open-target";
import { toast } from "@/client/lib/toast";
import { cn, commandKeyHeld } from "@/client/lib/utils";
import {
  type Bookmark,
  type BookmarkFolder,
  type BookmarkOp,
  OTHER_ROOT,
  OTHER_ROOT_TITLE,
  rootOf,
} from "@/shared/bookmarks";
import { APP_NAME } from "@instrument-org/shared";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/BookmarksSimple";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { type KeyboardEvent, useRef, useState } from "react";

/** What Cut or Copy kept last, for Paste in any window's Bookmarks page. */
const clipAtom = atom<ClipItem[]>([]);

/**
 * The Bookmarks page, a browser's bookmark manager in History's clothes:
 * every bookmark and folder as one outline in the bar's order, then All
 * Bookmarks, each folder opening in place, with a search over all of them.
 * A click picks a row,
 * ⌘-click and Shift-click pick more, and ⌘A all of them; a double click or
 * Return opens what is picked, Delete deletes it, and a drag moves it,
 * drawing a line where it would land or ringing the folder it would go
 * into, so nothing moves under the pointer until it lands. A bookmark
 * dragged alone goes wherever one of the bar does, and a tab or a link
 * dragged here is kept where it lands. A row's ⋮ and
 * its right click have the same menu; the page's ⋯ sorts and adds.
 */
export function BookmarksPage({
  onSearch,
  q,
}: {
  onSearch: (q: string) => void;
  q: string;
}) {
  const store = useStore();
  const state = useAtomValue(bookmarksStateAtom);
  const apply = useSetAtom(applyBookmarkOpsAtom);
  const folders = useBookmarkFolders();
  const [clip, setClip] = useAtom(clipAtom);
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set([OTHER_ROOT]),
  );
  const [selection, setSelection] = useState<Selection>(NOTHING_SELECTED);
  // The row the arrows step from: the last one clicked or stepped to.
  const [focusId, setFocusId] = useState<string>();
  const [editing, setEditing] = useState<
    | { bookmark: Bookmark; isNew: boolean; kind: "bookmark" }
    | { folder: BookmarkFolder; kind: "folder" }
    | { kind: "newFolder" }
  >();
  const isSearch = q.trim() !== "";
  const rows = outlineRows(state, { open, q });
  const order = rows.map((row) => row.id);
  const picked = rows.filter((row) => selection.ids.has(row.id));
  const openAddress = useOpenAddress();
  const placesOf = useWindowPlaces();
  const openAll = useOpenAllBookmarks();
  const list = useRef<HTMLDivElement>(null);

  const select = (next: Selection) => {
    setSelection(next);
  };
  const toggleFolder = (id: string, isOpen?: boolean) => {
    setOpen((current) => {
      const next = new Set(current);
      if (isOpen ?? !next.has(id)) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  /** The rows a menu or a key acts on: what is picked, where the row is among it, else the row alone. */
  const actingOn = (row?: OutlineRow): OutlineRow[] =>
    row && !selection.ids.has(row.id) ? [row] : picked;

  const openInNewTabs = (targets: readonly OutlineRow[]) => {
    const now = store.get(bookmarksStateAtom);
    const urls = targets.flatMap((row) =>
      row.kind === "bookmark"
        ? [row.bookmark.url]
        : now.bookmarks
            .filter((bookmark) =>
              row.kind === "root"
                ? rootOf(now, bookmark) === OTHER_ROOT
                : bookmark.folder === row.folder.id,
            )
            .map((bookmark) => bookmark.url),
    );
    urls.forEach((url, index) => {
      openAddress(url, { behind: index > 0, newTab: true });
    });
  };

  const remove = (targets: readonly OutlineRow[]) => {
    const now = store.get(bookmarksStateAtom);
    const removed = topmostPicked(now, new Set(targets.map((row) => row.id)));
    const count = removed.bookmarks.length + removed.folders.length;
    if (count === 0) {
      return;
    }
    void apply(
      [...removed.folders, ...removed.bookmarks].map(
        (each): BookmarkOp => ({ id: each.id, type: "remove" }),
      ),
    );
    setSelection(NOTHING_SELECTED);
    const onlyBookmark = removed.bookmarks[0];
    const only =
      removed.folders[0]?.title ??
      (onlyBookmark ? bookmarkName(onlyBookmark) : undefined);
    toast(
      count === 1 && only !== undefined
        ? `Deleted “${only}”`
        : `Deleted ${count.toString()} bookmarks`,
      {
        action: {
          label: UNDO_LABEL,
          onClick: () => {
            void apply(restoreOps(now, removed));
          },
        },
      },
    );
  };

  const copy = (targets: readonly OutlineRow[]) => {
    const now = store.get(bookmarksStateAtom);
    const items = clipOf(now, rows, new Set(targets.map((row) => row.id)));
    setClip(items);
    // Their addresses too, for pasting anywhere else.
    void navigator.clipboard.writeText(
      items
        .flatMap((item) =>
          item.kind === "bookmark" ? [item.url] : item.items.map((i) => i.url),
        )
        .join("\n"),
    );
  };

  const paste = (over?: OutlineRow) => {
    if (clip.length === 0) {
      return;
    }
    const now = store.get(bookmarksStateAtom);
    const place = pastePlace(
      now,
      over ?? picked.at(-1),
      clip.some((item) => item.kind === "folder"),
    );
    void apply(pasteOps(now, clip, place));
  };

  const edit = (row: OutlineRow) => {
    if (row.kind === "root") {
      return;
    }
    setEditing(
      row.kind === "bookmark"
        ? { bookmark: row.bookmark, isNew: false, kind: "bookmark" }
        : { folder: row.folder, kind: "folder" },
    );
  };

  /** Opens a row the way a double click or Return does: a bookmark in a tab of its own, a folder or All Bookmarks in place. */
  const openRow = (row: OutlineRow) => {
    if (row.kind !== "bookmark") {
      if (!isSearch) {
        toggleFolder(row.id);
      }
      return;
    }
    openAddress(row.bookmark.url, { newTab: true });
  };

  /** Shows a search's match where it is filed: the search let go, its folder and All Bookmarks open, the row picked. */
  const showInFolder = (row: OutlineRow) => {
    if (row.kind === "bookmark" && row.root) {
      toggleFolder(row.root, true);
    }
    if (row.kind === "bookmark" && row.folder) {
      toggleFolder(row.folder.id, true);
    }
    onSearch("");
    setSelection({ anchor: row.id, ids: new Set([row.id]) });
  };

  /** A folder's or All Bookmarks' Open All (N) and Open All in New Window, off where nothing is directly in it (`bookmarksToOpen`). */
  const openAllItems = (of: string): RowMenuItem[] => {
    const bookmarks = bookmarksToOpen(state, of);
    const count = bookmarks.length;
    return [
      {
        disabled: count === 0,
        label: count === 0 ? "Open All" : `Open All (${count.toString()})`,
        run: () => {
          openAll(bookmarks, "group");
        },
      },
      {
        disabled: count === 0,
        label: "Open All in New Window",
        run: () => {
          openAll(bookmarks, "window");
        },
      },
    ];
  };

  const menuOf = (row: OutlineRow): RowMenuItem[] => {
    if (row.kind === "root") {
      return [
        ...(clip.length > 0 && !isSearch
          ? [
              {
                label: "Paste",
                run: () => {
                  paste(row);
                },
              },
              "separator" as const,
            ]
          : []),
        ...openAllItems(OTHER_ROOT),
      ];
    }
    const targets = actingOn(row);
    const isOne = targets.length === 1;
    const pages = targets.filter((each) => each.kind === "bookmark");
    const opens =
      isOne && row.kind === "bookmark"
        ? placesOf((options) => {
            openAddress(row.bookmark.url, options);
          }).filter((place) => place.id !== "openNewGroup")
        : [];
    return [
      ...(isOne
        ? [
            {
              label: row.kind === "folder" ? "Rename…" : "Edit…",
              run: () => {
                edit(row);
              },
            },
          ]
        : []),
      ...(isOne &&
      isSearch &&
      row.kind === "bookmark" &&
      (row.folder ?? row.root)
        ? [
            {
              label: "Show in Folder",
              run: () => {
                showInFolder(row);
              },
            },
          ]
        : []),
      {
        destructive: true,
        label: "Delete",
        run: () => {
          remove(targets);
        },
      },
      "separator",
      {
        label: "Cut",
        run: () => {
          copy(targets);
          remove(targets);
        },
      },
      {
        label: "Copy",
        run: () => {
          copy(targets);
        },
      },
      ...(clip.length > 0 && !isSearch
        ? [
            {
              label: "Paste",
              run: () => {
                paste(row);
              },
            },
          ]
        : []),
      "separator",
      ...(opens.length > 0
        ? opens.map((place) => ({ label: place.label, run: place.run }))
        : isOne && row.kind === "folder"
          ? openAllItems(row.folder.id)
          : [
              {
                label:
                  pages.length === targets.length && targets.length > 1
                    ? `Open All (${targets.length.toString()}) in New Tabs`
                    : "Open All in New Tabs",
                run: () => {
                  openInNewTabs(targets);
                },
              },
            ]),
    ];
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, [role=menu]")
    ) {
      return;
    }
    const isCommand = commandKeyHeld(event.nativeEvent);
    const key = event.key.toLowerCase();
    const focusedAt = order.indexOf(focusId ?? "");
    const step = (by: number) => {
      const next =
        order[Math.min(order.length - 1, Math.max(0, focusedAt + by))];
      if (next === undefined) {
        return;
      }
      setFocusId(next);
      setSelection(
        event.shiftKey
          ? selectionAfterClick(selection, order, next, { extend: true })
          : { anchor: next, ids: new Set([next]) },
      );
      list.current
        ?.querySelector(`[data-outline-row="${CSS.escape(next)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    const focused = rows[focusedAt];
    if (key === "arrowdown" || key === "arrowup") {
      event.preventDefault();
      step(focusedAt === -1 ? 0 : key === "arrowdown" ? 1 : -1);
    } else if (
      (key === "arrowright" || key === "arrowleft") &&
      focused !== undefined &&
      focused.kind !== "bookmark" &&
      !isSearch
    ) {
      event.preventDefault();
      toggleFolder(focused.id, key === "arrowright");
    } else if (key === "enter" && picked.length > 0) {
      event.preventDefault();
      if (picked.length === 1 && picked[0]) {
        openRow(picked[0]);
      } else {
        openInNewTabs(picked);
      }
    } else if ((key === "delete" || key === "backspace") && picked.length > 0) {
      event.preventDefault();
      remove(picked);
    } else if (key === "escape" && picked.length > 0) {
      event.preventDefault();
      setSelection(NOTHING_SELECTED);
    } else if (isCommand && key === "a") {
      event.preventDefault();
      setSelection({ anchor: order[0], ids: new Set(order) });
    } else if (isCommand && key === "c" && picked.length > 0) {
      event.preventDefault();
      copy(picked);
    } else if (isCommand && key === "x" && picked.length > 0) {
      event.preventDefault();
      copy(picked);
      remove(picked);
    } else if (isCommand && key === "v" && !isSearch) {
      event.preventDefault();
      paste();
    }
  };

  useOutlineTarget({ isOff: isSearch, list: () => list.current, rows });
  const drop = useOutlineDrop();
  /**
   * A press that past the start holds the rows picked, or its own row alone
   * where it is not picked, and picks what it holds. A bookmark alone is
   * held as the bar's are, landing anywhere one does; several rows, or a
   * folder, are held as rows of the page, which move only on it.
   */
  const pressRow = (
    event: React.PointerEvent<HTMLElement>,
    row: OutlineRow,
  ) => {
    if (row.kind === "root") {
      return;
    }
    const ids = selection.ids.has(row.id)
      ? order.filter((each) => each !== OTHER_ROOT && selection.ids.has(each))
      : [row.id];
    const onHeld = () => {
      setSelection({ anchor: ids.at(-1), ids: new Set(ids) });
    };
    if (ids.length === 1 && row.kind === "bookmark") {
      pressBookmark(
        event,
        {
          id: row.bookmark.id,
          title: titleOfRow(row),
          url: row.bookmark.url,
        },
        onHeld,
      );
    } else if (!isSearch) {
      pressRows(
        event,
        {
          ids,
          title:
            ids.length === 1
              ? titleOfRow(row)
              : `${ids.length.toString()} bookmarks`,
        },
        onHeld,
      );
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);
  useFindTarget({
    anchor: searchRef,
    openFind: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  });
  const empty = rows.length === 0;
  return (
    <div
      className="@container/activity flex h-full min-h-0 flex-col bg-background"
      data-find-surface
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 @min-[640px]/activity:px-6">
        <h1 className="mr-1 text-base font-semibold">Bookmarks</h1>
        {picked.length > 1 ? (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-lg bg-foreground/6 px-3 text-sm">
            <span className="font-medium">{`${picked.length.toString()} selected`}</span>
            <span className="flex-1" />
            <Button
              onClick={() => {
                setSelection(NOTHING_SELECTED);
              }}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                remove(picked);
              }}
              size="sm"
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        ) : (
          <div className="flex w-64 max-w-full">
            <SearchField
              chord="findInPage"
              inputRef={searchRef}
              onChange={onSearch}
              placeholder="Search bookmarks"
              value={q}
            />
          </div>
        )}
        <span className="flex-1" />
        <PageMenu
          isSearch={isSearch}
          onAddBookmark={() => {
            setEditing({
              bookmark: {
                id: crypto.randomUUID(),
                order: 0,
                title: "",
                url: "",
              },
              isNew: true,
              kind: "bookmark",
            });
          }}
          onAddFolder={() => {
            setEditing({ kind: "newFolder" });
          }}
          onSort={() => {
            void apply(sortByNameOps(store.get(bookmarksStateAtom)));
            toast("Sorted by name");
          }}
        />
      </div>
      {empty ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
          {isSearch
            ? `Nothing matches “${q}”.`
            : "Press the star at the end of an address to bookmark it."}
        </div>
      ) : (
        <div
          aria-label="Bookmarks"
          aria-multiselectable
          className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none @min-[640px]/activity:px-6"
          data-keyboard-home
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            // A press on the page around the rows lets go of what is picked.
            if (event.target === event.currentTarget) {
              setSelection(NOTHING_SELECTED);
            }
          }}
          ref={list}
          role="listbox"
          tabIndex={0}
        >
          <div className="relative rounded-xl border border-border bg-card p-2">
            {rows.map((row) => (
              <OutlineRowView
                drop={drop.row}
                isHeld={drop.held.has(row.id)}
                isPicked={selection.ids.has(row.id)}
                isSearch={isSearch}
                key={`${row.id}${row.kind === "bookmark" && row.folder ? ":in" : ""}`}
                menu={menuOf(row)}
                onClick={(event) => {
                  setFocusId(row.id);
                  select(
                    selectionAfterClick(selection, order, row.id, {
                      extend: event.shiftKey,
                      toggle: commandKeyHeld(event.nativeEvent),
                    }),
                  );
                }}
                onMenu={() => {
                  if (!selection.ids.has(row.id)) {
                    setSelection({ anchor: row.id, ids: new Set([row.id]) });
                  }
                }}
                onOpen={() => {
                  openRow(row);
                }}
                onPointerDown={(event) => {
                  pressRow(event, row);
                }}
                onToggle={() => {
                  toggleFolder(row.id);
                }}
                row={row}
              />
            ))}
          </div>
        </div>
      )}
      {editing?.kind === "bookmark" && (
        <BookmarkEditor
          bookmark={editing.bookmark}
          isNew={editing.isNew}
          onClose={() => {
            setEditing(undefined);
            list.current?.focus();
          }}
        />
      )}
      {editing?.kind === "folder" && (
        <BookmarkNameDialog
          action="Save"
          name={editing.folder.title}
          onClose={() => {
            setEditing(undefined);
            list.current?.focus();
          }}
          onCommit={(title) => {
            folders.rename(editing.folder, title);
          }}
          title="Rename folder"
        />
      )}
      {editing?.kind === "newFolder" && (
        <BookmarkNameDialog
          action="Create"
          name=""
          onClose={() => {
            setEditing(undefined);
            list.current?.focus();
          }}
          onCommit={(title) => {
            folders.create(title);
          }}
          title="New folder"
        />
      )}
    </div>
  );
}

function titleOfRow(row: OutlineRow): string {
  return row.kind === "root"
    ? OTHER_ROOT_TITLE
    : row.kind === "folder"
      ? row.folder.title
      : bookmarkName(row.bookmark);
}

/**
 * What a bookmark opens, said under its name: a site's address, a chat, a
 * file or a folder, or one of the app's own pages; with the folder it is
 * filed in, in a search.
 */
function kindOf(url: string): string {
  const target = targetOfAddress(url);
  if (!target) {
    return `${APP_NAME} page`;
  }
  if (target.kind === "page") {
    return bareAddress(target.url);
  }
  if (target.kind === "path") {
    return target.isFolder ? "Folder" : "File";
  }
  const screen = matchScreen(target.href).kind;
  return screen === "chat" ||
    screen === "chatOfSession" ||
    screen === "chatLink"
    ? "Chat"
    : `${APP_NAME} page`;
}

/** The page's ⋯: what acts on every bookmark, as a browser's manager has it. */
function PageMenu({
  isSearch,
  onAddBookmark,
  onAddFolder,
  onSort,
}: {
  isSearch: boolean;
  onAddBookmark: () => void;
  onAddFolder: () => void;
  onSort: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="More" size="icon-sm" variant="ghost">
          <DotsThreeIcon className="size-4.5" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={isSearch} onSelect={onSort}>
          Sort by name
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isSearch} onSelect={onAddBookmark}>
          Add new bookmark…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isSearch} onSelect={onAddFolder}>
          Add new folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One row of the outline, History's row less its time and its box: a
 * folder's caret, the mark, the name, what it is, and its ⋮. What is in
 * a folder or All Bookmarks sits indented under it.
 */
function OutlineRowView({
  drop,
  isHeld,
  isPicked,
  isSearch,
  menu,
  onClick,
  onMenu,
  onOpen,
  onPointerDown,
  onToggle,
  row,
}: {
  /** The row what is dragged would land at now, which this row draws if it is it. */
  drop: { at: "after" | "before" | "into"; id: string } | undefined;
  isHeld: boolean;
  isPicked: boolean;
  isSearch: boolean;
  menu: RowMenuItem[];
  onClick: (event: React.MouseEvent) => void;
  /** Its menu is opening, which picks it where it is not picked. */
  onMenu: () => void;
  onOpen: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onToggle: () => void;
  row: OutlineRow;
}) {
  const at = drop?.id === row.id ? drop.at : undefined;
  const isInto = at === "into";
  const line = at === "before" ? "top" : at === "after" ? "bottom" : false;
  const depth = isSearch ? 0 : row.depth;
  const sub =
    row.kind !== "bookmark"
      ? row.count === 1
        ? "1 bookmark"
        : `${row.count.toString()} bookmarks`
      : isSearch && (row.folder ?? row.root)
        ? `${kindOf(row.bookmark.url)} · in ${row.folder?.title ?? OTHER_ROOT_TITLE}`
        : kindOf(row.bookmark.url);
  return (
    <ContextMenu
      onOpenChange={(isOpen) => {
        if (isOpen) {
          onMenu();
        }
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          aria-selected={isPicked}
          className={cn(
            "group/row relative flex min-h-10 cursor-default items-center gap-3 rounded-lg px-2.5 select-none",
            depth === 1 && "ml-7.5",
            depth === 2 && "ml-15",
            isPicked ? "bg-foreground/8" : "hover:bg-foreground/5",
            isInto && DROP_TONE,
            isHeld && "opacity-40",
          )}
          data-outline-row={row.id}
          onClick={onClick}
          onDoubleClick={onOpen}
          onPointerDown={onPointerDown}
          role="option"
          title={row.kind === "bookmark" ? row.bookmark.url : undefined}
        >
          {line && (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-2.5 h-0.5 rounded-full bg-primary",
                line === "top" ? "-top-px" : "-bottom-px",
              )}
              data-slot="bookmark-drop-line"
            />
          )}
          {row.kind !== "bookmark" && !isSearch ? (
            <button
              aria-expanded={row.isOpen}
              aria-label={row.isOpen ? "Close folder" : "Open folder"}
              className="-mr-1.5 grid size-4 shrink-0 cursor-default place-items-center text-foreground/50"
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              type="button"
            >
              <CaretRightIcon
                className={cn(
                  "size-3.5 transition-transform",
                  row.isOpen && "rotate-90",
                )}
              />
            </button>
          ) : null}
          <span className="grid size-5 shrink-0 place-items-center">
            {row.kind === "root" ? (
              <BookmarksSimpleIcon className="size-4 text-foreground/60" />
            ) : row.kind === "folder" ? (
              <FolderSimpleIcon className="size-4 text-foreground/60" />
            ) : (
              <AddressMark address={row.bookmark.url} />
            )}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="min-w-0 shrink truncate text-sm">
              {titleOfRow(row)}
            </span>
            <span className="min-w-0 truncate text-[13px] text-muted-foreground">
              {sub}
            </span>
          </span>
          <DropdownMenu
            onOpenChange={(isOpen) => {
              if (isOpen) {
                onMenu();
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="More"
                className={cn(
                  "shrink-0 text-foreground/60 data-[state=open]:opacity-100",
                  isPicked
                    ? ""
                    : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                size="icon-sm"
                variant="ghost"
              >
                <DotsThreeVerticalIcon className="size-4" weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <RowMenu components={dropdownMenuComponents} items={menu} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <RowMenu components={contextMenuComponents} items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** One line of a row's menu, or a rule between groups of them. */
type RowMenuItem =
  | "separator"
  | {
      destructive?: boolean;
      disabled?: boolean;
      label: string;
      run: () => void;
    };

/** A row's menu, written once for its ⋮ and its right click. */
function RowMenu({
  components: { Item, Separator },
  items,
}: {
  components: MenuComponents;
  items: RowMenuItem[];
}) {
  return items.map((item, index) =>
    item === "separator" ? (
      <Separator key={`rule-${index.toString()}`} />
    ) : (
      <Item
        disabled={item.disabled}
        key={item.label}
        onSelect={item.run}
        variant={item.destructive ? "destructive" : "default"}
      >
        {item.label}
      </Item>
    ),
  );
}
