import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { type ArtifactPanel } from "@/client/schemas/artifact-panel";
import { TASK_FOLDER_NAMES } from "@instrument-org/workspace/client";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { fork } from "radashi";
import { useState } from "react";

import { FilePreviewCard } from "./file-preview-card";
import { FilePreviewListItem } from "./file-preview-list-item";
import { FolderPreviewListItem } from "./folder-preview-list-item";

interface FilesGridProps {
  alignEnd?: boolean;
  compact?: boolean;
  files: TaskFileViewerFile[];
  folders?: SessionMessageDataPart.FolderAttachmentDataPart[];
  initialVisibleCount?: number;
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
const EMPTY_FOLDERS: SessionMessageDataPart.FolderAttachmentDataPart[] = [];

export function FilesGrid({
  alignEnd = false,
  compact = false,
  files,
  folders = EMPTY_FOLDERS,
  initialVisibleCount = DEFAULT_INITIAL_VISIBLE_COUNT,
  prioritizeUserFiles = false,
}: FilesGridProps) {
  const navigate = useNavigate({ from: "/tasks/$id/" });
  const search = useSearch({
    from: "/_app/tasks/$id/",
    shouldThrow: false,
  });
  const selectedArtifactFile = search?.artifactPanel ?? null;

  const handleFileClick = (file: TaskFileViewerFile) => {
    if (!search) {
      return;
    }
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: {
          filePath: file.filePath,
          modifiedAt: file.modifiedAt,
          type: "file",
        },
      }),
    });
  };

  const [isExpanded, setIsExpanded] = useState(false);

  // Only `output/` (deliverables), `attachments/` (user inputs), `downloads/`
  // (agent-fetched files), and root-level files surface to the user. Root files
  // cover a deliverable an agent saved to the task root instead of `output/`.
  // Nested scratch inside the agent's `work/` project stays hidden.
  const [outputFiles, nonOutputFiles] = fork(files, (file) =>
    isFileInTaskFolder(file, TASK_FOLDER_NAMES.output),
  );
  const [attachmentFiles, nonAttachmentFiles] = fork(nonOutputFiles, (file) =>
    isFileInTaskFolder(file, TASK_FOLDER_NAMES.attachments),
  );
  const [downloadFiles, nonDownloadFiles] = fork(nonAttachmentFiles, (file) =>
    isFileInTaskFolder(file, TASK_FOLDER_NAMES.downloads),
  );
  const [rootFiles] = fork(nonDownloadFiles, isRootFile);

  const sortedOutputFiles = sortByRichPreview(outputFiles);
  const sortedAttachmentFiles = sortByRichPreview(attachmentFiles);
  const sortedDownloadFiles = sortByRichPreview(downloadFiles);
  const sortedRootFiles = sortByRichPreview(rootFiles);

  const mainFiles = prioritizeUserFiles
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

  const listCollapsedCount = initialVisibleCount + PEEK_COUNT;

  // Media collapses on its own budget (square previews are tall); list content
  // keeps the base budget plus a peek row. Splitting them keeps a big set of
  // images down to ~2 rows instead of pushing the whole grid past three.
  const allMedia = compact ? [] : mainFiles.filter(hasMediaPreview);
  const listFiles = compact
    ? mainFiles
    : mainFiles.filter((file) => !hasMediaPreview(file));

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

  const isSingleMediaFile = mediaPreviewFiles.length === 1;

  // The fade sits at the very bottom of the grid; when that bottom row is tall
  // square media (no shorter list rows below it), fade higher into the row.
  const bottomSectionIsMedia =
    mediaPreviewFiles.length > 0 &&
    rowCardFiles.length === 0 &&
    otherFiles.length === 0 &&
    folders.length === 0;

  const gridSections = (
    <>
      {mediaPreviewFiles.length > 0 && (
        <div className="@container">
          <div
            className={cn("flex flex-wrap gap-2", alignEnd && "justify-end")}
          >
            {mediaPreviewFiles.map((file) => (
              <div
                className={cn(
                  "shrink-0 grow-0",
                  isSingleMediaFile
                    ? "w-full @md:w-[calc((100%/3*2)-(0.5rem/3))]"
                    : "w-[calc((100%/2)-(0.5rem/2))]",
                  // 3-up once the column is wide; the message column tops out
                  // near 40rem, so @2xl (42rem) could never trigger.
                  "@xl:w-[calc((100%/3)-(0.5rem*2/3))]",
                )}
                key={file.filePath}
              >
                <FilePreviewCard
                  file={file}
                  isSelected={isArtifactPanelFileSelected(
                    file,
                    selectedArtifactFile,
                  )}
                  onClick={() => {
                    handleFileClick(file);
                  }}
                />
              </div>
            ))}
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
                isSelected={isArtifactPanelFileSelected(
                  file,
                  selectedArtifactFile,
                )}
                key={file.filePath}
                onClick={() => {
                  handleFileClick(file);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {(otherFiles.length > 0 || folders.length > 0) && (
        <div
          className={cn(
            "flex flex-wrap items-start gap-2",
            alignEnd && "justify-end",
          )}
        >
          {folders.map((folder) => (
            <div className="h-12 max-w-48 min-w-0" key={folder.id}>
              <FolderPreviewListItem folder={folder} />
            </div>
          ))}
          {otherFiles.map((file) => (
            <div className="h-12 max-w-48 min-w-0" key={file.filePath}>
              <FilePreviewListItem
                file={file}
                isSelected={isArtifactPanelFileSelected(
                  file,
                  selectedArtifactFile,
                )}
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

function hasMediaPreview(file: TaskFileViewerFile) {
  const fileType = getFileType(file);
  return fileType === "image" || fileType === "video";
}

function hasRowCardPreview(file: TaskFileViewerFile) {
  const fileType = getFileType(file);
  return (
    fileType === "html" ||
    fileType === "pdf" ||
    fileType === "markdown" ||
    fileType === "text" ||
    fileType === "code" ||
    fileType === "audio" ||
    fileType === "unknown"
  );
}

function isArtifactPanelFileSelected(
  file: TaskFileViewerFile,
  artifactPanel: ArtifactPanel | null,
) {
  return (
    artifactPanel?.type === "file" &&
    file.filePath === artifactPanel.filePath &&
    file.modifiedAt === artifactPanel.modifiedAt
  );
}

function isFileInTaskFolder(file: TaskFileViewerFile, folderName: string) {
  return file.filePath.startsWith(`${folderName}/`);
}

function isRootFile(file: TaskFileViewerFile) {
  // Root-level, non-dotfile: surfaces a deliverable saved to the task root while
  // hiding setup dotfiles like `.gitignore`.
  return !file.filePath.includes("/") && !file.filePath.startsWith(".");
}

function sortByRichPreview(files: TaskFileViewerFile[]) {
  const [media, rest] = fork(files, hasMediaPreview);
  const [rowCard, other] = fork(rest, hasRowCardPreview);
  return [...media, ...rowCard, ...other];
}
