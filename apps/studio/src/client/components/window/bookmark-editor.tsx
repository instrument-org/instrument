import {
  addressOfTyped,
  bookmarkEditOps,
  NEW_FOLDER_NAME,
  newFolderOps,
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
  applyBookmarkOps,
  type Bookmark,
  type BookmarkFolder,
  bookmarkPlaces,
  type Bookmarks,
  keyOfPlace,
  orderAfter,
  placeOf,
  placeOfKey,
  siblingsIn,
} from "@/shared/bookmarks";
import { isInstrumentAddress } from "@instrument-org/shared";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/BookmarksSimple";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useId, useState } from "react";

/**
 * Chrome's Edit bookmark dialog: the name, the address, and the bar and
 * All Bookmarks with their folders as a tree to file it in, with New
 * folder under it, which makes one in the place picked. Nothing changes
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
  const tree = usePlaceTree(
    state,
    initialFolder ?? keyOfPlace(placeOf(state, bookmark)),
  );
  const hasUrlField = !isInstrumentAddress(bookmark.url);
  const url = hasUrlField ? addressOfTyped(typedUrl) : bookmark.url;

  const save = () => {
    if (url === undefined) {
      return;
    }
    void apply(
      bookmarkEditOps(state, bookmark, {
        folder: tree.picked,
        newFolders: tree.newFolders,
        title,
        url,
      }),
    );
    setLastFolder(tree.picked ?? null);
    onClose();
  };

  return (
    <EditorDialog
      onClose={onClose}
      onNewFolder={tree.makeFolder}
      onSave={save}
      canSave={url !== undefined}
      title={isNew ? "Add bookmark" : "Edit bookmark"}
    >
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
      <PlaceTree tree={tree} />
    </EditorDialog>
  );
}

/**
 * Chrome's Add folder dialog: the name, and the tree of places to make it
 * in, with New folder to make one there first. Save makes the folder last
 * in the place picked, or right after `after` where that is still the place
 * it opened on; an empty name makes it "New folder".
 */
export function FolderEditor({
  after,
  initialPlace,
  onClose,
}: {
  /** The item in the place it opens on that the folder goes right after, by id; last without one. */
  after?: string | undefined;
  /** The place picked as it opens, by its key (`placeOfKey`), the bar without one. */
  initialPlace?: string | undefined;
  onClose: () => void;
}) {
  const state = useAtomValue(bookmarksStateAtom);
  const apply = useSetAtom(applyBookmarkOpsAtom);
  const ids = useId();
  const [title, setTitle] = useState(NEW_FOLDER_NAME);
  const tree = usePlaceTree(state, initialPlace);

  const save = () => {
    const folderOps = newFolderOps(state, tree.newFolders);
    const so = applyBookmarkOps(state, folderOps);
    const place = placeOfKey(tree.picked);
    const there = siblingsIn(so, place.folder, place.root);
    const at =
      tree.picked === initialPlace && after !== undefined
        ? there.findIndex((each) => each.id === after)
        : -1;
    const before = there[at];
    const next = there[at + 1];
    void apply([
      ...folderOps,
      {
        folder: {
          id: crypto.randomUUID(),
          order:
            before === undefined
              ? orderAfter(there)
              : next === undefined
                ? before.order + 1
                : (before.order + next.order) / 2,
          title: title.trim() || NEW_FOLDER_NAME,
          ...place,
        },
        type: "addFolder",
      },
    ]);
    onClose();
  };

  return (
    <EditorDialog
      canSave
      onClose={onClose}
      onNewFolder={tree.makeFolder}
      onSave={save}
      title="Add folder"
    >
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
      </div>
      <PlaceTree tree={tree} />
    </EditorDialog>
  );
}

/** The dialog both editors are: a title, what is edited, and New folder, Cancel and Save under it. */
function EditorDialog({
  canSave,
  children,
  onClose,
  onNewFolder,
  onSave,
  title,
}: {
  canSave: boolean;
  children: ReactNode;
  onClose: () => void;
  onNewFolder: () => void;
  onSave: () => void;
  title: string;
}) {
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
            onSave();
          }}
        >
          <DialogTitle>{title}</DialogTitle>
          {children}
          <DialogFooter className="sm:justify-between">
            <Button onClick={onNewFolder} type="button" variant="outline">
              New folder
            </Button>
            <div className="flex gap-2">
              <Button onClick={onClose} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={!canSave} type="submit">
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PlaceTreeState = ReturnType<typeof usePlaceTree>;

/**
 * The place picked in an editor's tree, by its key (`placeOfKey`), and the
 * folders New folder made there, which stay the editor's own until Save.
 */
function usePlaceTree(state: Bookmarks, initial: string | undefined) {
  const [picked, setPicked] = useState(initial);
  const [newFolders, setNewFolders] = useState<BookmarkFolder[]>([]);
  // The new folder whose name is being typed, by id.
  const [naming, setNaming] = useState<string>();
  const shown = applyBookmarkOps(state, newFolderOps(state, newFolders));
  return {
    naming,
    newFolders,
    picked,
    /** Every place, the folders made here among them. */
    places: bookmarkPlaces(shown),
    /** Makes a folder in the place picked, picks it, and starts naming it. */
    makeFolder: () => {
      const made: BookmarkFolder = {
        id: crypto.randomUUID(),
        order: 0,
        title: NEW_FOLDER_NAME,
        ...placeOfKey(picked),
      };
      setNewFolders((current) => [...current, made]);
      setPicked(made.id);
      setNaming(made.id);
    },
    pick: setPicked,
    rename: (id: string, title: string) => {
      setNewFolders((current) =>
        current.map((made) => (made.id === id ? { ...made, title } : made)),
      );
    },
    stopNaming: () => {
      setNaming(undefined);
    },
  };
}

/** The bar and All Bookmarks with every folder under them, each folder under the one it is in. */
function PlaceTree({ tree }: { tree: PlaceTreeState }) {
  const typed = (id: string) =>
    tree.newFolders.find((made) => made.id === id)?.title ?? "";
  return (
    <div className="h-48 rounded-lg border border-border">
      <div
        aria-label="Folder"
        className="flex h-full flex-col gap-0.5 overflow-y-auto scroll-fade-y p-1"
        role="tree"
      >
        {tree.places.map((each) =>
          each.key !== undefined && each.key === tree.naming ? (
            <div
              className="flex h-8 items-center gap-2 pr-1"
              key={each.key}
              style={{ paddingLeft: indentOf(each.depth) }}
            >
              <FolderSimpleIcon className="size-4 shrink-0 text-foreground/60" />
              <Input
                aria-label="Folder name"
                autoFocus
                className="h-7"
                onBlur={tree.stopNaming}
                onChange={(event) => {
                  if (each.key !== undefined) {
                    tree.rename(each.key, event.currentTarget.value);
                  }
                }}
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
                onKeyDown={(event) => {
                  // Return names the folder; the dialog saves on the next.
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    tree.stopNaming();
                  }
                }}
                value={typed(each.key)}
              />
            </div>
          ) : (
            <FolderRow
              depth={each.depth}
              icon={
                each.depth === 0 ? (
                  <BookmarksSimpleIcon className="size-4 shrink-0" />
                ) : (
                  <FolderSimpleIcon className="size-4 shrink-0 text-foreground/60" />
                )
              }
              isPicked={tree.picked === each.key}
              key={each.key ?? "bar"}
              onPick={() => {
                tree.pick(each.key);
              }}
              title={each.title || NEW_FOLDER_NAME}
            />
          ),
        )}
      </div>
    </div>
  );
}

/** How far in a place's row starts, a step for each folder it is in. */
function indentOf(depth: number): string {
  return `${(0.5 + depth * 1.5).toString()}rem`;
}

/** One place in the editor's tree: a root, or a folder in one. */
function FolderRow({
  depth,
  icon,
  isPicked,
  onPick,
  title,
}: {
  depth: number;
  icon: ReactNode;
  isPicked: boolean;
  onPick: () => void;
  title: string;
}) {
  return (
    <button
      aria-selected={isPicked}
      className={cn(
        "flex h-8 shrink-0 cursor-default items-center gap-2 rounded-md pr-2 text-left text-sm",
        isPicked ? "bg-foreground/8 font-medium" : "hover:bg-foreground/5",
      )}
      onClick={onPick}
      role="treeitem"
      style={{ paddingLeft: indentOf(depth) }}
      type="button"
    >
      {icon}
      <span className="min-w-0 truncate">{title}</span>
    </button>
  );
}

/** The room before a folder in a folder in a list of places, a step for each folder past the first it is in. */
export function PlaceIndent({ depth }: { depth: number }) {
  return (
    <span
      aria-hidden
      className="shrink-0"
      style={{ width: `${(depth - 1).toString()}rem` }}
    />
  );
}
