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
import { useParams } from "@tanstack/react-router";
import { fork } from "radashi";

import { FilePreviewCard } from "./file-preview-card";
import { FilePreviewListItem } from "./file-preview-list-item";
import { MEDIA_CARD_ASPECT } from "./media-card-shape";
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
   * Only media reserves a tile. A media tile's height follows from its width,
   * so the box is exact; a list row's is its contents, and a box guessed at is
   * a smaller version of the jump it was drawn to avoid.
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

  const handleFileClick = (file: TaskFileViewerFile) => {
    openFiles([file.filePath]);
  };

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

  // How wide one tile is, as a share of the row.
  //
  // Every section below is laid out on the same columns -- two of them, three
  // once the column is wide enough to read a row card at -- so that the edges
  // line up down the whole grid. A tile in a set takes one column; one on its
  // own is the reply's subject and takes all but the last, which is what gives
  // it an edge to line up on rather than a width of its own.
  //
  // Container queries, not viewport ones: the same grid is drawn in a message
  // column, a pane, and a card.
  const mediaTileWidth = cn(
    "shrink-0 grow-0",
    isSingleMediaFile
      ? "w-full @xl:w-[calc((100%/3*2)-(0.5rem/3))]"
      : "w-[calc((100%/2)-(0.5rem/2))] @xl:w-[calc((100%/3)-(0.5rem*2/3))]",
  );

  // And what shape it takes at that width. A tile in a set is square, so that
  // the row's height is settled before the slowest card in it arrives; a lone
  // tile has no row to agree with, and at this width a square one is a deep
  // band of empty card above and below a landscape picture. It takes the shape
  // the files an agent hands over are usually in instead.
  const mediaTileShape = isSingleMediaFile ? "wide" : "square";

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
                data-slot="files-grid-media"
                key={file.filePath}
              >
                <FilePreviewCard
                  file={file}
                  isSelected={isPaneFileSelected(file, pane)}
                  onClick={() => {
                    handleFileClick(file);
                  }}
                  shape={mediaTileShape}
                />
              </div>
            ))}
            {hasPendingMediaTile && (
              <div
                className={mediaTileWidth}
                data-slot="files-grid-media"
                key="pending"
              >
                <Skeleton
                  className={cn(
                    "w-full rounded-2xl",
                    MEDIA_CARD_ASPECT[mediaTileShape],
                  )}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {rowCardFiles.length > 0 && (
        <div className="@container">
          <div
            className={cn(
              // The same columns the media tiles above take, so a lone tile's
              // edge lands on one of these. Three only once there is room for
              // a filename beside a thumbnail in a third of the column.
              "grid grid-cols-1 gap-2 @sm:grid-cols-2 @xl:grid-cols-3",
              alignEnd && "justify-items-end",
            )}
          >
            {rowCardFiles.map((file) => (
              <div data-slot="files-grid-card" key={file.filePath}>
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
            <div className="h-12 max-w-48 min-w-0" key={file.filePath}>
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

  // Every file a reply named is drawn. What the agent chose to hand over is
  // the reply, so there is nothing here worth putting behind a control: a set
  // long enough to be in the way is a set the reader still has to be able to
  // see the end of.
  return <div className="flex flex-col gap-2">{gridSections}</div>;
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
  notebook: true,
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
