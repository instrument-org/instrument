import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useTaskPane, useTaskPaneActions } from "@/client/hooks/use-task-pane";
import {
  type FileType,
  getFileType,
  isMediaFile,
} from "@/client/lib/get-file-type";
import {
  isFileInTaskFolder,
  isRootTaskFile,
} from "@/client/lib/task-file-visibility";
import { cn } from "@/client/lib/utils";
import { TASK_FOLDER_NAMES, TaskPane } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { useParams } from "@tanstack/react-router";
import { fork } from "radashi";
import { useLayoutEffect, useRef, useState } from "react";

import { FilePreviewCard } from "./file-preview-card";
import { FilePreviewListItem } from "./file-preview-list-item";
import {
  COLLAPSED_MAX_HEIGHT_PX,
  collapseFor,
  FADE_HEIGHT_PX,
  FILE_ITEM_SELECTOR,
  offsetTopWithin,
} from "./files-grid-collapse";
import { useReleaseAutoScroll } from "./transcript-scroll-context";
import { Skeleton } from "./ui/skeleton";

interface FilesGridProps {
  alignEnd?: boolean;
  compact?: boolean;
  files: TaskFileViewerFile[];
  /**
   * A path still being typed, drawn as an empty tile in the place its card will
   * take.
   *
   * The point is the box, not the file: a half-typed path resolves to nothing,
   * so nothing is resolved. What it buys is that the row is already the height
   * it settles at when the finished line replaces the tile -- which matters
   * because a fence's last line is withheld until the message stops streaming,
   * and that is the same frame the session goes idle in.
   *
   * Only media reserves a tile. A media tile's height is its width, so the box
   * is exact; a list row's is its contents, and a box guessed at is a smaller
   * version of the jump it was drawn to avoid.
   *
   * It is a box and not a file, so the collapse below leaves it out of its
   * count: a tile the clamp cuts is nothing anyone can be offered to see.
   */
  pendingFilePath?: string;
  // Takes the list as given instead of bucketing it by task folder. For a set
  // an agent chose and ordered: the buckets exist to find the deliverables in
  // everything a turn touched, which is a judgment already made here, and they
  // drop anything outside the task folder -- including a shared folder's files.
  preserveOrder?: boolean;
  prioritizeUserFiles?: boolean;
}

export function FilesGrid({
  alignEnd = false,
  compact = false,
  files,
  pendingFilePath,
  preserveOrder = false,
  prioritizeUserFiles = false,
}: FilesGridProps) {
  // Absent outside the task route -- a previewed conversation, the debug
  // scenarios -- where a card is still worth drawing and clicking it has
  // nowhere to go.
  const taskId = useParams({
    from: "/_app/tasks/$id/",
    shouldThrow: false,
  })?.id;
  const pane = useTaskPane(taskId);
  const { openFiles } = useTaskPaneActions(taskId);
  const releaseAutoScroll = useReleaseAutoScroll();

  const handleFileClick = (file: TaskFileViewerFile) => {
    openFiles([file.filePath]);
  };

  const [isExpanded, setIsExpanded] = useState(false);
  // Undefined once the grid is measured and found to fit: the clamp is applied
  // from the first paint, and taken off again rather than left to cut a grid
  // that has nothing to hide.
  const [collapsedHeight, setCollapsedHeight] = useState<number | undefined>(
    COLLAPSED_MAX_HEIGHT_PX,
  );
  const [hiddenFileCount, setHiddenFileCount] = useState(0);
  const [isClipped, setIsClipped] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const mainFiles = preserveOrder
    ? files
    : bucketByTaskFolder(files, prioritizeUserFiles);

  const mediaFiles = compact ? [] : mainFiles.filter(isMediaFile);
  const listFiles = compact
    ? mainFiles
    : mainFiles.filter((file) => !isMediaFile(file));
  const rowCardFiles = compact ? [] : listFiles.filter(hasRowCardPreview);
  const otherFiles = compact
    ? listFiles
    : listFiles.filter((file) => !hasRowCardPreview(file));

  // See `pendingFilePath`.
  const hasPendingMediaTile =
    !compact &&
    pendingFilePath !== undefined &&
    isMediaFile({ filename: pendingFilePath });

  const mediaTileCount = mediaFiles.length + (hasPendingMediaTile ? 1 : 0);
  const isSingleMediaFile = mediaTileCount === 1;
  const itemCount = mediaFiles.length + rowCardFiles.length + otherFiles.length;

  // A layout effect: the clamp is applied on the first paint, and the fade and
  // the button that say so are measured before it. A frame of hard-cut grid is
  // the one thing this collapse exists to avoid.
  //
  // Re-run on the count as well as watching the box, because a file can arrive
  // without moving anything: one more chip on a row with room for it leaves
  // every box exactly where it was, and if that row is the cut one there is now
  // one more file behind the fade.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const content = contentRef.current;
    if (!grid || !content) {
      return;
    }

    // Where each file lands, at the size it lands, in the units the clamp is
    // written in. Clipping does not move anything, so this reads the same
    // collapsed or expanded, and the count survives the expand it triggers.
    //
    // Three pieces of state rather than the one object `collapseFor` returns,
    // so a measurement that lands on the same numbers costs nothing.
    const measure = () => {
      const collapse = collapseFor(
        [...grid.querySelectorAll<HTMLElement>(FILE_ITEM_SELECTOR)].map(
          (item) => {
            const top = offsetTopWithin(item, grid);
            return {
              bottom: top + item.offsetHeight,
              isPending: item.dataset.pending !== undefined,
              top,
            };
          },
        ),
      );

      setCollapsedHeight(collapse.height);
      setHiddenFileCount(collapse.hiddenFiles);
      setIsClipped(collapse.clipped);
    };

    measure();

    // Width decides how the sections wrap, and it moves under a splitter drag
    // and an app-zoom change alike -- neither of which is a render here. Height
    // is watched for the case the deps below cannot see: the same files at a
    // different size. Coalesced to one recompute per frame, since a drag
    // delivers several records in the same one.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    });
    observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [itemCount, hasPendingMediaTile]);

  const hasMoreFiles = hiddenFileCount > 0;
  const isCollapsed = isClipped && !isExpanded;

  // How wide one tile is, as a share of the row. One on its own is the reply's
  // subject and takes the column; a set of them is a grid, two across and three
  // once the column is wide enough to read them at. Both are container queries:
  // the same grid is drawn in a message column, a pane, and a card.
  const mediaTileWidth = cn(
    "shrink-0 grow-0",
    isSingleMediaFile
      ? "w-full @md:w-[calc((100%/3*2)-(0.5rem/3))]"
      : "w-[calc((100%/2)-(0.5rem/2))] @xl:w-[calc((100%/3)-(0.5rem*2/3))]",
  );

  const gridSections = (
    <>
      {mediaTileCount > 0 && (
        <div className="@container">
          <div
            className={cn("flex flex-wrap gap-2", alignEnd && "justify-end")}
          >
            {mediaFiles.map((file) => (
              <div
                className={mediaTileWidth}
                data-slot="files-grid-item"
                key={file.filePath}
              >
                <FilePreviewCard
                  file={file}
                  isSelected={isPaneFileSelected(file, pane)}
                  onClick={() => {
                    handleFileClick(file);
                  }}
                />
              </div>
            ))}
            {hasPendingMediaTile && (
              <div
                className={mediaTileWidth}
                data-pending
                data-slot="files-grid-item"
                key="pending"
              >
                <Skeleton className="aspect-square w-full rounded-2xl" />
              </div>
            )}
          </div>
        </div>
      )}

      {rowCardFiles.length > 0 && (
        <div className="@container">
          <div
            className={cn(
              "grid grid-cols-1 gap-2 @sm:grid-cols-2",
              alignEnd && "justify-items-end",
            )}
          >
            {rowCardFiles.map((file) => (
              <div data-slot="files-grid-item" key={file.filePath}>
                <FilePreviewCard
                  file={file}
                  isSelected={isPaneFileSelected(file, pane)}
                  onClick={() => {
                    handleFileClick(file);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {otherFiles.length > 0 && (
        <div
          className={cn(
            "flex flex-wrap items-start gap-2",
            alignEnd && "justify-end",
          )}
        >
          {otherFiles.map((file) => (
            <div
              className="h-12 max-w-48 min-w-0"
              data-slot="files-grid-item"
              key={file.filePath}
            >
              <FilePreviewListItem
                file={file}
                isSelected={isPaneFileSelected(file, pane)}
                onClick={() => {
                  handleFileClick(file);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );

  // Every path was filtered out above, so the grid has nothing to draw. Render
  // nothing rather than an empty box, which a flex parent still gives a gap.
  if (mainFiles.length === 0 && !hasPendingMediaTile) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Every file is drawn and the clamp cuts what does not fit, rather than
          the render stopping at a count: what a row holds is settled by the
          container, so the cut can only be made once the layout is.

          `overflow-clip` rather than `hidden`, which is a scroll container to
          everything but the user: focus landing on a cut card would scroll it
          into view inside the box, sliding the grid up under a mask that stays
          where it is. Nothing scrolls here, and `onFocus` opens the grid
          instead.

          `p-2`/`-m-2` gives card shadows and focus rings room inside the clip
          and the mask -- both cut to the border box -- without moving where the
          cards sit. `relative` is what the measurement reads its offsets
          against. The mask is spelled out here rather than taken from
          `scroll-fade-y`, which is driven by a scroll timeline this static
          collapse doesn't have. */}
      <div
        className="relative -m-2 overflow-clip p-2"
        onFocus={(event) => {
          const grid = gridRef.current;
          const item = event.target.closest<HTMLElement>(FILE_ITEM_SELECTOR);
          if (
            isCollapsed &&
            grid &&
            item &&
            collapsedHeight !== undefined &&
            offsetTopWithin(item, grid) + item.offsetHeight > collapsedHeight
          ) {
            releaseAutoScroll();
            setIsExpanded(true);
          }
        }}
        ref={gridRef}
        style={{
          maskImage: isCollapsed
            ? `linear-gradient(to bottom, black calc(100% - ${FADE_HEIGHT_PX}px), transparent)`
            : undefined,
          maxHeight: isExpanded ? undefined : collapsedHeight,
        }}
      >
        {/* What the measurement watches. The clamped box above it is pinned to
            a height while collapsed, so a card that grows under the clamp is a
            change a `ResizeObserver` on it cannot see; this one is free to be
            as tall as its contents. */}
        <div className="flex flex-col gap-2" ref={contentRef}>
          {gridSections}
        </div>
      </div>

      {hasMoreFiles && (
        <button
          className={cn(
            "flex h-7 w-full items-center justify-center gap-1 rounded-lg text-xs text-muted-foreground",
            "hover:bg-muted hover:text-foreground",
          )}
          onClick={() => {
            releaseAutoScroll();
            setIsExpanded((expanded) => !expanded);
          }}
          type="button"
        >
          {isExpanded ? "Show less" : `Show ${hiddenFileCount} more`}
          {isExpanded ? (
            <CaretUpIcon className="size-3.5" />
          ) : (
            <CaretDownIcon className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

// Groups a turn's changed files into the folders that reach the user, richest
// preview first within each. Root files cover a deliverable an agent saved to
// the task root instead of `output/`; see `isSurfacedTaskFile` for which paths
// reach the user at all.
function bucketByTaskFolder(
  files: TaskFileViewerFile[],
  prioritizeUserFiles: boolean,
) {
  const [outputFiles, nonOutputFiles] = fork(files, (file) =>
    isFileInTaskFolder(file.filePath, TASK_FOLDER_NAMES.output),
  );
  const [attachmentFiles, nonAttachmentFiles] = fork(nonOutputFiles, (file) =>
    isFileInTaskFolder(file.filePath, TASK_FOLDER_NAMES.attachments),
  );
  const [downloadFiles, nonDownloadFiles] = fork(nonAttachmentFiles, (file) =>
    isFileInTaskFolder(file.filePath, TASK_FOLDER_NAMES.downloads),
  );
  const [rootFiles] = fork(nonDownloadFiles, (file) =>
    isRootTaskFile(file.filePath),
  );

  const sortedOutputFiles = sortByRichPreview(outputFiles);
  const sortedAttachmentFiles = sortByRichPreview(attachmentFiles);
  const sortedDownloadFiles = sortByRichPreview(downloadFiles);
  const sortedRootFiles = sortByRichPreview(rootFiles);

  return prioritizeUserFiles
    ? [
        ...sortedAttachmentFiles,
        ...sortedOutputFiles,
        ...sortedRootFiles,
        ...sortedDownloadFiles,
      ]
    : [
        ...sortedOutputFiles,
        ...sortedRootFiles,
        ...sortedAttachmentFiles,
        ...sortedDownloadFiles,
      ];
}

// Which types get a full-width preview row rather than a compact chip. Images
// and video are the exceptions: they have their own square media section above.
//
// Exhaustive rather than a list of matches, so a new `FileType` has to say
// which it is. As a list, adding the document types silently moved Word, Excel,
// PowerPoint and CSV attachments from rows to chips, because those files used
// to arrive here as `unknown` and `code`.
const ROW_CARD_PREVIEW: Record<FileType, boolean> = {
  archive: true,
  audio: true,
  code: true,
  csv: true,
  docx: true,
  html: true,
  image: false,
  iwork: true,
  jsonl: true,
  markdown: true,
  parquet: true,
  pdf: true,
  pptx: true,
  sqlite: true,
  text: true,
  unknown: true,
  video: false,
  xlsx: true,
};

function hasRowCardPreview(file: TaskFileViewerFile) {
  return ROW_CARD_PREVIEW[getFileType(file)];
}

// Which card the pane is showing. The path decides it: an mtime in the
// comparison meant a card lost its own highlight the moment the file it points
// at changed underneath it.
//
// A closed pane shows nothing, so nothing is highlighted -- its selection is
// kept for the reopen, not a claim about what the user is looking at.
//
// Against the stored key rather than `selectedTab`, whose fallback to the last
// tab is right for deciding what to render and wrong for deciding what looks
// chosen: with the browser selected it names a file tab, and a card would sit
// highlighted while the pane showed a web page.
function isPaneFileSelected(file: TaskFileViewerFile, pane: TaskPane.Type) {
  return (
    pane.open &&
    pane.selected === TaskPane.tabKey(TaskPane.fileTab(file.filePath))
  );
}

function sortByRichPreview(files: TaskFileViewerFile[]) {
  const [media, rest] = fork(files, isMediaFile);
  const [rowCard, other] = fork(rest, hasRowCardPreview);
  return [...media, ...rowCard, ...other];
}
