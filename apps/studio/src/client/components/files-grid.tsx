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
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useParams } from "@tanstack/react-router";
import { fork } from "radashi";
import { useState } from "react";

import { FilePreviewCard } from "./file-preview-card";
import { FilePreviewListItem } from "./file-preview-list-item";
import { useReleaseAutoScroll } from "./transcript-scroll-context";
import { Skeleton } from "./ui/skeleton";

interface FilesGridProps {
  alignEnd?: boolean;
  compact?: boolean;
  files: TaskFileViewerFile[];
  initialVisibleCount?: number;
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
   */
  pendingFilePath?: string;
  // Takes the list as given instead of bucketing it by task folder. For a set
  // an agent chose and ordered: the buckets exist to find the deliverables in
  // everything a turn touched, which is a judgment already made here, and they
  // drop anything outside the task folder -- including a shared folder's files.
  preserveOrder?: boolean;
  prioritizeUserFiles?: boolean;
}

const DEFAULT_INITIAL_VISIBLE_COUNT = 6;
// Square media previews are much taller than a list row, so they collapse to
// their own ~2-row cap (up to three across at the widest) instead of sharing the
// list budget, which otherwise showed too many rows of images.
const MEDIA_COLLAPSED_COUNT = 6;
// Extra list files rendered past the visible count when collapsed; their bottoms
// dissolve under the fade mask to hint at more without a hard cutoff.
const PEEK_COUNT = 2;

export function FilesGrid({
  alignEnd = false,
  compact = false,
  files,
  initialVisibleCount = DEFAULT_INITIAL_VISIBLE_COUNT,
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
  const selectedTab = TaskPane.selectedTab(pane);

  const handleFileClick = (file: TaskFileViewerFile) => {
    openFiles([file.filePath]);
  };

  const [isExpanded, setIsExpanded] = useState(false);

  const mainFiles = preserveOrder
    ? files
    : bucketByTaskFolder(files, prioritizeUserFiles);

  const listCollapsedCount = initialVisibleCount + PEEK_COUNT;

  // Media collapses on its own budget (square previews are tall); list content
  // keeps the base budget plus a peek row. Splitting them keeps a big set of
  // images down to ~2 rows instead of pushing the whole grid past three.
  const allMedia = compact ? [] : mainFiles.filter(isMediaFile);
  const listFiles = compact
    ? mainFiles
    : mainFiles.filter((file) => !isMediaFile(file));

  const shownMedia = isExpanded
    ? allMedia
    : allMedia.slice(0, MEDIA_COLLAPSED_COUNT);
  const shownListFiles = isExpanded
    ? listFiles
    : listFiles.slice(0, listCollapsedCount);

  const hiddenFileCount =
    allMedia.length -
    shownMedia.length +
    (listFiles.length - shownListFiles.length);
  const hasMoreFiles = hiddenFileCount > 0;

  const mediaPreviewFiles = shownMedia;
  const rowCardFiles = compact ? [] : shownListFiles.filter(hasRowCardPreview);
  const otherFiles = compact
    ? shownListFiles
    : shownListFiles.filter((file) => !hasRowCardPreview(file));

  // See `pendingFilePath`. Not while media is capped, where the tile would be
  // drawn past the cap rather than where the file is going to land.
  const hasPendingMediaTile =
    !compact &&
    pendingFilePath !== undefined &&
    isMediaFile({ filename: pendingFilePath }) &&
    shownMedia.length === allMedia.length;

  const mediaTileCount =
    mediaPreviewFiles.length + (hasPendingMediaTile ? 1 : 0);
  const isSingleMediaFile = mediaTileCount === 1;

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

  // The fade sits at the very bottom of the grid; when that bottom row is tall
  // square media (no shorter list rows below it), fade higher into the row.
  const bottomSectionIsMedia =
    mediaTileCount > 0 && rowCardFiles.length === 0 && otherFiles.length === 0;

  const gridSections = (
    <>
      {mediaTileCount > 0 && (
        <div className="@container">
          <div
            className={cn("flex flex-wrap gap-2", alignEnd && "justify-end")}
          >
            {mediaPreviewFiles.map((file) => (
              <div className={mediaTileWidth} key={file.filePath}>
                <FilePreviewCard
                  file={file}
                  isSelected={isPaneFileSelected(file, selectedTab)}
                  onClick={() => {
                    handleFileClick(file);
                  }}
                />
              </div>
            ))}
            {hasPendingMediaTile && (
              <div className={mediaTileWidth} key="pending">
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
              <FilePreviewCard
                file={file}
                isSelected={isPaneFileSelected(file, selectedTab)}
                key={file.filePath}
                onClick={() => {
                  handleFileClick(file);
                }}
              />
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
            <div className="h-12 max-w-48 min-w-0" key={file.filePath}>
              <FilePreviewListItem
                file={file}
                isSelected={isPaneFileSelected(file, selectedTab)}
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
      {hasMoreFiles && !isExpanded ? (
        // Dissolve the trailing peek files into the surface so the collapse
        // reads as "more below" rather than a hard cutoff. scroll-fade-y is
        // scroll-timeline driven and doesn't apply to this static collapse, so
        // the bottom mask is spelled out inline. p-2/-m-2 gives card shadows and
        // outlines room inside the mask box (masks clip to the border-box)
        // without shifting where the cards sit.
        <div
          className={cn(
            "-m-2 flex flex-col gap-2 p-2",
            bottomSectionIsMedia
              ? "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_5.5rem),transparent)]"
              : "[mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)]",
          )}
        >
          {gridSections}
        </div>
      ) : (
        gridSections
      )}

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
function isPaneFileSelected(
  file: TaskFileViewerFile,
  selectedTab: TaskPane.Tab | undefined,
) {
  return selectedTab?.type === "file" && file.filePath === selectedTab.filePath;
}

function sortByRichPreview(files: TaskFileViewerFile[]) {
  const [media, rest] = fork(files, isMediaFile);
  const [rowCard, other] = fork(rest, hasRowCardPreview);
  return [...media, ...rowCard, ...other];
}
