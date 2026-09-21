import { computerHiddenFilesAtom } from "@/client/atoms/orchestrator";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { Skeleton } from "@/client/components/ui/skeleton";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useOrchestrator } from "./context";
import { isInside, segmentsOf } from "./host-path";

/** How far each level of the tree stands in from the last, and the first from the edge, in layout px. */
const INDENT = 14;
const EDGE = 6;

/**
 * The tree beside a file opened from the Finder, the way an editor keeps one
 * beside a document: rooted at the folder the Finder was standing in, that
 * folder open down to the file, the file selected, no search over it. A
 * folder opens and closes on a press; a file pressed takes the document's
 * place in the same tab, which is what lets a person leaf between the files
 * of a folder without going back to the Finder. Each folder is read the
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
  return (
    <div
      aria-label="Files beside the document"
      className="flex h-full min-h-0 flex-col overflow-y-auto py-1.5 pr-1.5 text-[12.5px] select-none"
      role="tree"
    >
      <Folder
        depth={0}
        isOpen={isOpen}
        name={rootName}
        onOpen={onOpen}
        onToggle={toggle}
        path={root}
        selected={selected}
      />
    </div>
  );
}

/**
 * One folder of the tree: its row, and under it, while it is open, its
 * folders and then its files by name, the way an editor's tree lists them.
 * What the system hides stays hidden unless the Finder is showing it.
 */
function Folder({
  depth,
  isOpen,
  name,
  onOpen,
  onToggle,
  path,
  selected,
}: {
  depth: number;
  isOpen: (path: string) => boolean;
  name: string;
  onOpen: (hostPath: string) => void;
  onToggle: (path: string) => void;
  path: string;
  selected: string;
}) {
  const { taskId } = useOrchestrator();
  const showsHidden = useAtomValue(computerHiddenFilesAtom);
  const open = isOpen(path);
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
    .toSorted(
      (a, b) =>
        Number(a.kind === "file") - Number(b.kind === "file") ||
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );
  return (
    <>
      <Row
        caret={
          open ? (
            <CaretDownIcon className="size-2.5" />
          ) : (
            <CaretRightIcon className="size-2.5" />
          )
        }
        depth={depth}
        icon={<FileSystemFolderGlyph className="h-3 w-auto" />}
        isExpanded={open}
        name={name}
        onPress={() => {
          onToggle(path);
        }}
      />
      {open &&
        (listing.data === undefined ? (
          listing.isError ? (
            <p
              className="truncate py-1 text-[11px] text-muted-foreground"
              style={{ paddingLeft: EDGE + (depth + 1) * INDENT + 16 }}
            >
              Could not read this folder
            </p>
          ) : (
            <Skeleton
              className="my-1.5 h-3 w-24"
              style={{ marginLeft: EDGE + (depth + 1) * INDENT + 16 }}
            />
          )
        ) : (
          entries.map((entry) =>
            entry.kind === "folder" ? (
              <Folder
                depth={depth + 1}
                isOpen={isOpen}
                key={entry.path}
                name={entry.name}
                onOpen={onOpen}
                onToggle={onToggle}
                path={entry.path}
                selected={selected}
              />
            ) : (
              <Row
                depth={depth + 1}
                icon={
                  <FileTypeIcon className="size-3.5" fileName={entry.name} />
                }
                isSelected={entry.path === selected}
                key={entry.path}
                name={entry.name}
                onPress={() => {
                  onOpen(entry.path);
                }}
              />
            ),
          )
        ))}
    </>
  );
}

/** One row of the tree: a folder with its caret and mark, or a file with its kind's mark; the selected file filled and brought into view. */
function Row({
  caret,
  depth,
  icon,
  isExpanded,
  isSelected = false,
  name,
  onPress,
}: {
  caret?: ReactNode;
  depth: number;
  icon: ReactNode;
  isExpanded?: boolean;
  isSelected?: boolean;
  name: string;
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
        "flex h-6.5 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left",
        isSelected
          ? "bg-accent font-medium text-foreground"
          : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground",
      )}
      onClick={onPress}
      ref={ref}
      role="treeitem"
      style={{ paddingLeft: EDGE + depth * INDENT }}
      title={name}
      type="button"
    >
      <span className="grid w-3 shrink-0 place-items-center text-muted-foreground">
        {caret}
      </span>
      <span className="grid size-4 shrink-0 place-items-center [&_svg]:max-h-3.5">
        {icon}
      </span>
      <span className="min-w-0 truncate">{name}</span>
    </button>
  );
}
