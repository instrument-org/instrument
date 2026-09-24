import { computerHiddenFilesAtom } from "@/client/atoms/orchestrator";
import {
  FileSystemFolderGlyph,
  type FileSystemItem,
  FileSystemRowGlyph,
  MENU_TARGET_CLASSNAME,
  SELECTED_ROW_CLASSNAME,
} from "@/client/components/extend/file-system";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { Delayed } from "@/client/components/ui/delayed";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { type ComputerListing } from "@instrument-org/workspace/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FolderMenu } from "./computer-page";
import { useOrchestrator } from "./context";
import { isInside, segmentsOf } from "./host-path";

/** How far each level of the tree stands in from the last, in layout px: the Finder's list's indent. */
const INDENT = 16;

type ListedEntry = ComputerListing["entries"][number];

/** What every row of the tree answers to, handed down from the tree. */
interface Rows {
  isOpen: (path: string) => boolean;
  /** The row a menu is open on, by path, outlined rather than selected. */
  menuTarget: string | undefined;
  onMenu: (entry: FileSystemItem) => void;
  onOpen: (hostPath: string) => void;
  onToggle: (path: string) => void;
  selected: string;
}

/**
 * The tree beside a file opened from the Finder, drawn the way the Finder's
 * list draws a folder: rooted at the folder the Finder was standing in, that
 * folder open down to the file, the file selected. Its rows are the list's
 * rows, at the list's size, with the chevron in a margin of its own and
 * folders among the files by name. A folder opens and closes on a press; a
 * file pressed takes the document's place in the same tab, which is what lets
 * a person leaf between the files of a folder without going back to the
 * Finder. A right-click offers what the Finder's menu does for the row, but
 * for a rename, which has no field here to type in. Each folder is read the
 * first time it is opened, and re-read on the Finder's own clock.
 */
export function FileTree({
  onOpen,
  root,
  selected,
}: {
  /** A file pressed in the tree, by where it is on the computer. */
  onOpen: (hostPath: string) => void;
  /** The folder the tree is rooted at. */
  root: string;
  /** The file the tab shows, which the tree is opened down to. */
  selected: string;
}) {
  const { askAbout, openScreen } = useOrchestrator();
  const queryClient = useQueryClient();
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const home = places.data?.favorites.find((place) => place.name === "Home");
  // The folders pressed open or shut, by path; the rest stand open down to
  // the selected file and shut elsewhere, so a file arrived at by a link
  // opens its own folders on the way.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (path: string) =>
    toggled[path] ?? (path === root || isInside(selected, path));
  const toggle = (path: string) => {
    setToggled((current) => ({ ...current, [path]: !isOpen(path) }));
  };
  const rootName =
    root === home?.path ? "Home" : (segmentsOf(root).at(-1) ?? root);
  const [menuItem, setMenuItem] = useState<FileSystemItem>();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const reread = () => {
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.computer.list.key(),
    });
  };
  const run = (action: () => Promise<unknown>) => {
    action().then(reread, (error: unknown) => {
      toast(error instanceof Error ? error.message : "That did not work");
    });
  };
  const menuHostPath =
    typeof menuItem?.metadata?.hostPath === "string"
      ? menuItem.metadata.hostPath
      : "";
  const rows = {
    isOpen,
    menuTarget: isMenuOpen ? menuHostPath : undefined,
    onMenu: (entry: FileSystemItem) => {
      setMenuItem(entry);
    },
    onOpen,
    onToggle: toggle,
    selected,
  };
  return (
    <ContextMenu onOpenChange={setIsMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          aria-label="Files beside the document"
          className="flex h-full min-h-0 flex-col overflow-y-auto px-1.5 py-1.5 text-sm select-none"
          // Only a row has a menu; the space around the rows has nothing to
          // act on.
          onContextMenu={(event) => {
            if (
              !(event.target instanceof Element) ||
              !event.target.closest('[role="treeitem"]')
            ) {
              event.preventDefault();
            }
          }}
          role="tree"
        >
          <Folder depth={0} name={rootName} path={root} rows={rows} />
        </div>
      </ContextMenuTrigger>
      <FolderMenu
        item={menuItem}
        onCopyPath={() => {
          void navigator.clipboard.writeText(menuHostPath);
        }}
        onDuplicate={() => {
          run(() => rpcClient.files.duplicate.call({ path: menuHostPath }));
        }}
        onNewDraft={
          askAbout && menuItem
            ? () => {
                askAbout([{ kind: menuItem.kind, path: menuHostPath }]);
              }
            : undefined
        }
        onNewFolder={undefined}
        onOpen={() => {
          onOpen(menuHostPath);
        }}
        onOpenInNewTab={() => {
          openScreen(folderHref(menuHostPath), { newTab: true });
        }}
        onQuickLook={undefined}
        onReveal={() => {
          run(() =>
            rpcClient.utils.showFileInFolder.call({ filepath: menuHostPath }),
          );
        }}
        onTrash={() => {
          run(() => rpcClient.files.trash.call({ path: menuHostPath }));
        }}
      />
    </ContextMenu>
  );
}

function FileRow({
  depth,
  entry,
  rows,
}: {
  depth: number;
  entry: ListedEntry;
  rows: Rows;
}) {
  const isPicture = entry.mimeType?.startsWith("image/") === true;
  return (
    <Row
      depth={depth}
      glyph={
        <FileSystemRowGlyph
          entry={{
            contentType: entry.mimeType,
            kind: "file",
            name: entry.name,
            // The same picture the Finder's rows draw, so it is read once.
            previewImageUrl: isPicture
              ? getComputerThumbnailUrl({
                  hostPath: entry.path,
                  size: 512,
                  version: entry.modifiedAt,
                })
              : undefined,
          }}
        />
      }
      isMenuTarget={rows.menuTarget === entry.path}
      isSelected={entry.path === rows.selected}
      name={entry.name}
      onMenu={() => {
        rows.onMenu({
          kind: "file",
          metadata: { hostPath: entry.path },
          name: entry.name,
          path: entry.path,
        });
      }}
      onPress={() => {
        rows.onOpen(entry.path);
      }}
    />
  );
}

/**
 * One folder of the tree: its row, and under it, while it is open, what it
 * holds by name, folders among the files. What the system hides stays hidden
 * unless the Finder is showing it.
 */
function Folder({
  depth,
  name,
  path,
  rows,
}: {
  depth: number;
  name: string;
  path: string;
  rows: Rows;
}) {
  const { taskId } = useOrchestrator();
  const showsHidden = useAtomValue(computerHiddenFilesAtom);
  const open = rows.isOpen(path);
  const listing = useQuery(
    rpcClient.workspace.computer.list.queryOptions({
      enabled: open,
      input: { id: taskId, path },
    }),
  );
  const entries = (listing.data?.entries ?? [])
    .filter(
      (entry) => showsHidden || (!entry.hidden && !entry.name.startsWith(".")),
    )
    .toSorted((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  return (
    <>
      <Row
        depth={depth}
        glyph={<FileSystemFolderGlyph className="h-3.5 w-auto shrink-0" />}
        isExpanded={open}
        isMenuTarget={rows.menuTarget === path}
        name={name}
        onMenu={() => {
          rows.onMenu({
            kind: "folder",
            metadata: { hostPath: path },
            name,
            path,
          });
        }}
        onPress={() => {
          rows.onToggle(path);
        }}
      />
      {open &&
        (listing.data === undefined ? (
          listing.isError ? (
            <p
              className="truncate py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * INDENT + 44 }}
            >
              Could not read this folder
            </p>
          ) : (
            <div className="h-6" style={{ paddingLeft: (depth + 1) * INDENT }}>
              <Delayed>
                <Skeleton className="mt-1.5 ml-11 h-3 w-24" />
              </Delayed>
            </div>
          )
        ) : (
          entries.map((entry) =>
            entry.kind === "folder" ? (
              <Folder
                depth={depth + 1}
                key={entry.path}
                name={entry.name}
                path={entry.path}
                rows={rows}
              />
            ) : (
              <FileRow
                depth={depth + 1}
                entry={entry}
                key={entry.path}
                rows={rows}
              />
            ),
          )
        ))}
    </>
  );
}

/**
 * One row of the tree, drawn as a row of the Finder's list: the chevron's
 * margin, the glyph, the name; the selected file tinted and brought into view.
 */
function Row({
  depth,
  glyph,
  isExpanded,
  isMenuTarget,
  isSelected = false,
  name,
  onMenu,
  onPress,
}: {
  depth: number;
  glyph: ReactNode;
  /** Set for a folder: whether it stands open. */
  isExpanded?: boolean;
  isMenuTarget: boolean;
  isSelected?: boolean;
  name: string;
  onMenu: () => void;
  onPress: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // The selected file is where the tree opens, whether it mounts selected
  // (the tab opening on a file deep in a long folder) or becomes so (a link
  // followed to another file); a row above the fold is scrolled to as well.
  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);
  return (
    <button
      aria-expanded={isExpanded}
      aria-level={depth + 1}
      aria-selected={isSelected}
      className={cn(
        "flex h-6 w-full min-w-0 shrink-0 items-center rounded-md px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        isSelected && SELECTED_ROW_CLASSNAME,
        isMenuTarget && MENU_TARGET_CLASSNAME,
      )}
      onClick={onPress}
      onContextMenu={onMenu}
      ref={ref}
      role="treeitem"
      title={name}
      type="button"
    >
      <span
        className="flex min-w-0 flex-1 items-center"
        style={{ paddingLeft: depth * INDENT }}
      >
        <span className="flex h-6 w-4 shrink-0 items-center justify-center">
          {isExpanded === undefined ? null : (
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform duration-100 motion-reduce:transition-none",
                isExpanded && "rotate-90",
              )}
              strokeWidth={2.5}
            />
          )}
        </span>
        <span className="ml-1.5 flex size-4 shrink-0 items-center justify-center">
          {glyph}
        </span>
        <span className="ml-1.5 min-w-0 truncate">{name}</span>
      </span>
    </button>
  );
}
