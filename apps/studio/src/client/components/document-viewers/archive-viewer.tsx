import { cn } from "@/client/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type FileEntry } from "@zip.js/zip.js";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { FileIcon } from "../file-icon";
import { FileLoading } from "../file-loading";
import { readArchiveEntries } from "./archive";
import {
  ViewerFindControl,
  ViewerToolbar,
  ViewerToolbarSpacer,
} from "./viewer-toolbar";

const ROW_HEIGHT = 32;
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * What an archive holds, without unpacking it.
 *
 * Members are listed by their full path rather than browsed as a tree. A zip is
 * a flat list of paths to begin with, and keeping it flat means the whole
 * archive is one findable surface: typing part of a name reaches it wherever it
 * sits, where a tree would make the reader guess which folder to open first.
 *
 * Nothing here is clickable. Reading a member means inflating it, and inflating
 * it means both a size guard and a route for content that has no path on disk;
 * both are worth doing and neither is free. Until then this answers "what is in
 * here", which is the question a reader has before deciding to extract.
 */
export function ArchiveViewer({ url }: { url: string }) {
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    data: entries,
    error,
    isLoading,
  } = useQuery({
    queryFn: () => readArchiveEntries(url),
    queryKey: ["archive-file", url],
    retry: false,
  });

  const shown = useMemo(() => meaningfulEntries(entries ?? []), [entries]);

  // Matching walks every member, so it trails the field rather than keeping
  // pace with it, the same way the data grid's own find does.
  const deferredQuery = useDeferredValue(query);
  const matches = useMemo(
    () => findMatches({ entries: shown, query: deferredQuery }),
    [deferredQuery, shown],
  );

  // Every rendered row asks whether it matched, which `findMatches` has already
  // answered for the whole listing. Indexed once so the render reads an answer
  // rather than scanning the match list per row per frame.
  const matchRows = useMemo(() => new Set(matches), [matches]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: shown.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 12,
  });

  const activeIndex = matches.length === 0 ? 0 : activeMatch % matches.length;
  const current = matches[activeIndex];
  useEffect(() => {
    if (current !== undefined) {
      virtualizer.scrollToIndex(current, { align: "center" });
    }
  }, [current, virtualizer]);

  if (isLoading) {
    return <FileLoading />;
  }

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
  // which owns the "preview unavailable" card for every viewer.
  if (error) {
    throw error;
  }

  const goToMatch = (delta: number) => {
    if (matches.length === 0) {
      return;
    }
    const next = (activeIndex + delta) % matches.length;
    setActiveMatch(next < 0 ? next + matches.length : next);
  };

  let totalBytes = 0;
  for (const entry of shown) {
    totalBytes += entry.uncompressedSize;
  }

  return (
    <>
      <ViewerToolbar>
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {shown.length.toLocaleString()} {shown.length === 1 ? "item" : "items"}
          {/* Sizes are what the archive says about itself, which is exactly
              what a compression bomb overstates, so the total is labelled as a
              claim rather than presented as a measurement. */}
          {` · ${formatBytes(totalBytes)} unpacked`}
        </span>
        <ViewerToolbarSpacer />
        <ViewerFindControl
          activeMatch={activeIndex}
          matchCount={matches.length}
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

      <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const entry = shown[row.index];
            if (!entry) {
              return null;
            }
            const isMatch = matchRows.has(row.index);
            return (
              <div
                className={cn(
                  "absolute inset-x-0 flex items-center gap-2 px-3 text-[0.8125rem]",
                  row.index % 2 === 1 && "bg-muted/30",
                  isMatch && "bg-yellow-500/25",
                  current === row.index && "bg-yellow-500/60",
                )}
                key={entry.filename}
                style={{
                  height: row.size,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <FileIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  filename={basename(entry.filename)}
                />
                <span
                  className="min-w-0 flex-1 truncate"
                  title={entry.filename}
                >
                  {/* The folders a member sits in are dimmed rather than
                      dropped: the name is what someone is looking for, and the
                      path is how they find it again once it is unpacked. */}
                  <span className="text-muted-foreground">
                    {dirname(entry.filename)}
                  </span>
                  {basename(entry.filename)}
                </span>
                {entry.encrypted && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Encrypted
                  </span>
                )}
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {formatBytes(entry.uncompressedSize)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string) {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/** Indices into the listing, so a match can be scrolled to and highlighted. */
function findMatches({
  entries,
  query,
}: {
  entries: FileEntry[];
  query: string;
}) {
  if (query === "") {
    return [];
  }
  const needle = query.toLowerCase();
  const found: number[] = [];
  for (const [index, entry] of entries.entries()) {
    if (entry.filename.toLowerCase().includes(needle)) {
      found.push(index);
    }
  }
  return found;
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
