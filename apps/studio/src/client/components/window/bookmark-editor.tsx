import {
  addressOfTyped,
  bookmarkEditOps,
  NEW_FOLDER_NAME,
} from "@/client/bookmarks/edit";
import {
  applyBookmarkOpsAtom,
  bookmarksStateAtom,
  lastBookmarkFolderAtom,
} from "@/client/bookmarks/store";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import {
  type Bookmark,
  type BookmarkFolder,
  bookmarkPlaces,
  keyOfPlace,
  OTHER_ROOT,
  placeOf,
} from "@/shared/bookmarks";
import { isInstrumentAddress } from "@instrument-org/shared";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/BookmarksSimple";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { useAtomValue, useSetAtom } from "jotai";
import { useId, useState } from "react";

/**
 * Chrome's Edit bookmark dialog: the name, the address, and the bar and
 * All Bookmarks with their folders as a tree to file it in, with New
 * folder under it, which makes one on the bar. Nothing changes
 * until Save, folders made here included, so Cancel leaves everything as it
 * was. An address the app itself names (a chat, a built-in page) is not
 * typed, so it has no field. Save waits for an address that reads as one.
 *
 * A bookmark not kept yet (`isNew`) is added by Save, which is how the
 * Bookmarks page's Add new bookmark works.
 */
export function BookmarkEditor({
  bookmark,
  initialFolder,
  isNew = false,
  onClose,
}: {
  bookmark: Bookmark;
  /** The place picked as it opens, by its key (`placeOfKey`), the bar without one; the bookmark's own by default. */
  initialFolder?: string | undefined;
  isNew?: boolean;
  onClose: () => void;
}) {
  const state = useAtomValue(bookmarksStateAtom);
  const apply = useSetAtom(applyBookmarkOpsAtom);
  const setLastFolder = useSetAtom(lastBookmarkFolderAtom);
  const ids = useId();
  const [title, setTitle] = useState(bookmark.title);
  const [typedUrl, setTypedUrl] = useState(bookmark.url);
  const [folder, setFolder] = useState<string | undefined>(
    initialFolder ?? keyOfPlace(placeOf(state, bookmark)),
  );
  const [newFolders, setNewFolders] = useState<BookmarkFolder[]>([]);
  // The new folder whose name is being typed, by id.
  const [naming, setNaming] = useState<string>();
  const hasUrlField = !isInstrumentAddress(bookmark.url);
  const url = hasUrlField ? addressOfTyped(typedUrl) : bookmark.url;
  // The folders made here go on the bar, after its own.
  const places = bookmarkPlaces(state);
  const otherAt = places.findIndex((place) => place.key === OTHER_ROOT);
  const rows = [
    ...places.slice(0, otherAt),
    ...newFolders.map((made) => ({
      depth: 1 as const,
      key: made.id,
      title: made.title,
    })),
    ...places.slice(otherAt),
  ];

  const save = () => {
    if (url === undefined) {
      return;
    }
    void apply(
      bookmarkEditOps(state, bookmark, { folder, newFolders, title, url }),
    );
    setLastFolder(folder ?? null);
    onClose();
  };

  return (
    <Dialog
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        data-bookmark-editor=""
        maxWidth="28rem"
        showCloseButton={false}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogTitle>{isNew ? "Add bookmark" : "Edit bookmark"}</DialogTitle>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[13px]">
            <label className="text-muted-foreground" htmlFor={`${ids}-name`}>
              Name
            </label>
            <Input
              autoFocus
              className="h-8"
              id={`${ids}-name`}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
              }}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              value={title}
            />
            {hasUrlField && (
              <>
                <label className="text-muted-foreground" htmlFor={`${ids}-url`}>
                  URL
                </label>
                <Input
                  aria-invalid={url === undefined}
                  className="h-8"
                  id={`${ids}-url`}
                  onChange={(event) => {
                    setTypedUrl(event.currentTarget.value);
                  }}
                  spellCheck={false}
                  value={typedUrl}
                />
              </>
            )}
          </div>
          <div
            aria-label="Folder"
            className="flex h-48 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1"
            role="tree"
          >
            {rows.map((each) =>
              each.key !== undefined && each.key === naming ? (
                <div
                  className="flex h-8 items-center gap-2 pr-1 pl-8"
                  key={each.key}
                >
                  <FolderSimpleIcon className="size-4 shrink-0 text-foreground/60" />
                  <Input
                    aria-label="Folder name"
                    autoFocus
                    className="h-7"
                    onBlur={() => {
                      setNaming(undefined);
                    }}
                    onChange={(event) => {
                      const typed = event.currentTarget.value;
                      setNewFolders((current) =>
                        current.map((made) =>
                          made.id === each.key
                            ? { ...made, title: typed }
                            : made,
                        ),
                      );
                    }}
                    onFocus={(event) => {
                      event.currentTarget.select();
                    }}
                    onKeyDown={(event) => {
                      // Return names the folder; the dialog saves on the next.
                      if (event.key === "Enter" || event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setNaming(undefined);
                      }
                    }}
                    value={each.title}
                  />
                </div>
              ) : (
                <FolderRow
                  icon={
                    each.depth === 0 ? (
                      <BookmarksSimpleIcon className="size-4 shrink-0" />
                    ) : (
                      <FolderSimpleIcon className="size-4 shrink-0 text-foreground/60" />
                    )
                  }
                  isIndented={each.depth === 1}
                  isPicked={folder === each.key}
                  key={each.key ?? "bar"}
                  onPick={() => {
                    setFolder(each.key);
                  }}
                  title={each.title || NEW_FOLDER_NAME}
                />
              ),
            )}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              onClick={() => {
                const made = {
                  id: crypto.randomUUID(),
                  order: 0,
                  title: NEW_FOLDER_NAME,
                };
                setNewFolders((current) => [...current, made]);
                setFolder(made.id);
                setNaming(made.id);
              }}
              type="button"
              variant="outline"
            >
              New folder
            </Button>
            <div className="flex gap-2">
              <Button onClick={onClose} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={url === undefined} type="submit">
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One place in the editor's tree: a root, or a folder in one. */
function FolderRow({
  icon,
  isIndented = false,
  isPicked,
  onPick,
  title,
}: {
  icon: React.ReactNode;
  isIndented?: boolean;
  isPicked: boolean;
  onPick: () => void;
  title: string;
}) {
  return (
    <button
      aria-selected={isPicked}
      className={cn(
        "flex h-8 shrink-0 cursor-default items-center gap-2 rounded-md px-2 text-left text-sm",
        isIndented && "pl-8",
        isPicked ? "bg-foreground/8 font-medium" : "hover:bg-foreground/5",
      )}
      onClick={onPick}
      role="treeitem"
      type="button"
    >
      {icon}
      <span className="min-w-0 truncate">{title}</span>
    </button>
  );
}
