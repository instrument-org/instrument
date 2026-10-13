import { type ViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileOpenControl } from "@/client/hooks/use-file-open-control";
import { cn, isMacOS } from "@/client/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type FileEntry } from "@zip.js/zip.js";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { FileSystemFolderGlyph, FileTypeIcon } from "../extend/file-system";
import { FileLoading } from "../file-loading";
import { OpenTargetIcon } from "../open-target-icon";
import { Button } from "../ui/button";
import { readArchiveEntries } from "./archive";
import {
  archiveTree,
  matchingFiles,
  relativePath,
  visibleRows,
} from "./archive-tree";
import {
  ViewerFindControl,
  ViewerToolbar,
  ViewerToolbarSpacer,
} from "./viewer-toolbar";

const ROW_HEIGHT = 28;
const INDENT = 16;
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * What an archive holds, without unpacking it.
 *
 * Members are drawn as the folders they will unpack into, the way a file
 * manager lists a folder, with the one folder most archives wrap everything in
 * taken as the root. Find filters rather than walks the tree: a match is
 * reached wherever it sits, with its folders dimmed beside its name.
 *
 * Nothing here is clickable past a folder's disclosure. Reading a member means
 * inflating it, which is the system's archive tool's job, and Extract hands the
 * file to it.
 */
export function ArchiveViewer({ file }: { file: ViewerFile }) {
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    data: entries,
    error,
    isLoading,
  } = useQuery({
    queryFn: () => readArchiveEntries(file.url),
    queryKey: ["archive-file", file.url],
    retry: false,
  });

  const root = useMemo(
    () => archiveTree(meaningfulEntries(entries ?? [])),
    [entries],
  );

  // Matching walks every member, so it trails the field rather than keeping
  // pace with it, the same way the data grid's own find does.
  const deferredQuery = useDeferredValue(query);
  const isFinding = deferredQuery !== "";
  const rows = useMemo(
    () =>
      isFinding
        ? matchingFiles(root, deferredQuery).map((node) => ({
            depth: 0,
            node,
          }))
        : visibleRows(root, expanded),
    [deferredQuery, expanded, isFinding, root],
  );

  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 12,
  });

  // While finding, every row is a match, so the active one is a row index.
  const activeIndex = rows.length === 0 ? 0 : activeMatch % rows.length;
  useEffect(() => {
    if (isFinding && rows.length > 0) {
      virtualizer.scrollToIndex(activeIndex, { align: "center" });
    }
  }, [activeIndex, isFinding, rows.length, virtualizer]);

  if (isLoading) {
    return <FileLoading />;
  }

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
  // which owns the "preview unavailable" card for every viewer.
  if (error) {
    throw error;
  }

  const goToMatch = (delta: number) => {
    if (!isFinding || rows.length === 0) {
      return;
    }
    const next = (activeIndex + delta) % rows.length;
    setActiveMatch(next < 0 ? next + rows.length : next);
  };

  const toggle = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <>
      <ViewerToolbar>
        <span className="min-w-0 truncate px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {root.fileCount.toLocaleString()}{" "}
          {root.fileCount === 1 ? "item" : "items"}
          {/* Sizes are what the archive says about itself, which is exactly
              what a compression bomb overstates, so the total is labeled as a
              claim rather than presented as a measurement. */}
          {` · ${formatBytes(root.size)} unpacked`}
        </span>
        <ViewerToolbarSpacer />
        <ExtractButton file={file} />
        <ViewerFindControl
          activeMatch={activeIndex}
          matchCount={isFinding ? rows.length : 0}
          onNextMatch={() => {
            goToMatch(1);
          }}
          onPreviousMatch={() => {
            goToMatch(-1);
          }}
          onQueryChange={(next) => {
            setQuery(next);
            setActiveMatch(0);
          }}
          query={query}
        />
      </ViewerToolbar>

      <div className="min-h-0 flex-1 overflow-auto py-1" ref={scrollRef}>
        {isFinding && rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing in this archive matches “{deferredQuery}”.
          </p>
        ) : null}
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) {
              return null;
            }
            const { depth, node } = row;
            const isFolder = node.kind === "folder";
            const isOpen = isFolder && expanded.has(node.path);
            const path = relativePath(root, node);
            return (
              <div
                aria-expanded={isFolder ? isOpen : undefined}
                className={cn(
                  "absolute inset-x-1 flex items-center gap-1.5 rounded-md pr-3 text-[0.8125rem]",
                  isFolder && "hover:bg-accent/60",
                  isFinding &&
                    virtualRow.index === activeIndex &&
                    "bg-yellow-500/40",
                )}
                // The virtual row rather than the member's name: a zip may list
                // the same path twice, and two rows sharing a key leaves them
                // drawn on top of each other.
                key={virtualRow.key}
                onClick={
                  isFolder
                    ? () => {
                        toggle(node.path);
                      }
                    : undefined
                }
                role={isFolder ? "button" : undefined}
                style={{
                  height: virtualRow.size,
                  paddingLeft: 4 + depth * INDENT,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                title={path}
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                  {isFolder ? (
                    <CaretRightIcon
                      className={cn(
                        "size-3 transition-transform",
                        isOpen && "rotate-90",
                      )}
                      weight="bold"
                    />
                  ) : null}
                </span>
                {isFolder ? (
                  <FileSystemFolderGlyph className="h-3.5 w-4 shrink-0 object-contain" />
                ) : (
                  <FileTypeIcon
                    className="size-4 shrink-0"
                    fileName={node.name}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {/* While finding, the folders a match sits in are dimmed
                      beside it: the name is what someone is looking for, and
                      the path is how they find it again once it is unpacked. */}
                  {isFinding ? (
                    <span className="text-muted-foreground">
                      {dirname(path)}
                    </span>
                  ) : null}
                  {node.name}
                </span>
                {node.kind === "file" && node.entry.encrypted ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Encrypted
                  </span>
                ) : null}
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {isFolder
                    ? `${node.fileCount.toLocaleString()} ${node.fileCount === 1 ? "item" : "items"}`
                    : formatBytes(node.entry.uncompressedSize)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * Unpacking belongs to the computer's own archive tool, which on a Mac is
 * Archive Utility: opened on a zip, it unpacks beside it without a window, so
 * the button says what that does. Elsewhere the default app is a browser of
 * the archive with its own Extract, and the button names it.
 */
function ExtractButton({ file }: { file: ViewerFile }) {
  const control = useFileOpenControl(file, { loadCandidates: false });
  if (!control.showOpen) {
    return null;
  }
  const label = isMacOS() ? "Extract" : control.openLabel;
  return (
    <Button
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={control.open}
      size="sm"
      type="button"
      variant="ghost"
    >
      <OpenTargetIcon className="size-4" file={file} />
      <span className="truncate">{label}</span>
    </Button>
  );
}

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string) {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

function formatBytes(bytes: number) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const label = BYTE_UNITS[unit] ?? "B";
  // Raw bytes stay whole; anything scaled keeps one decimal until it is big
  // enough that the decimal is noise.
  if (unit === 0) {
    return `${value} ${label}`;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${label}`;
}

/**
 * Archives written on macOS carry a parallel `__MACOSX` tree of resource forks
 * and a `.DS_Store` per folder. They are an artifact of how the archive was
 * made rather than anything the sender meant to include, and listing them
 * roughly doubles the apparent contents of an everyday zip.
 */
function meaningfulEntries(entries: FileEntry[]) {
  return entries.filter(
    (entry) =>
      !entry.filename.startsWith("__MACOSX/") &&
      basename(entry.filename) !== ".DS_Store",
  );
}
