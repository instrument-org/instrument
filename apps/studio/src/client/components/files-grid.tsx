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
import { Button } from "./ui/button";

interface FilesGridProps {
  alignEnd?: boolean;
  compact?: boolean;
  files: TaskFileViewerFile[];
  folders?: SessionMessageDataPart.FolderAttachmentDataPart[];
  initialVisibleCount?: number;
  prioritizeUserFiles?: boolean;
}

const DEFAULT_INITIAL_VISIBLE_COUNT = 6;
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

  const visibleMainFiles = mainFiles.slice(0, initialVisibleCount);
  const hasMoreFiles = mainFiles.length > initialVisibleCount;
  const hiddenFileCount = mainFiles.length - initialVisibleCount;
  const mainFilesToShow = isExpanded ? mainFiles : visibleMainFiles;

  const mediaPreviewFiles = compact
    ? []
    : mainFilesToShow.filter(hasMediaPreview);
  const rowCardFiles = compact ? [] : mainFilesToShow.filter(hasRowCardPreview);
  const otherFiles = compact
    ? mainFilesToShow
    : mainFilesToShow.filter(
        (file) => !hasMediaPreview(file) && !hasRowCardPreview(file),
      );

  const isSingleMediaFile = mediaPreviewFiles.length === 1;

  return (
    <div className="flex flex-col gap-2">
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
                  "@2xl:w-[calc((100%/3)-(0.5rem*2/3))]",
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

      {!isExpanded && hasMoreFiles && (
        <div className={cn("flex", alignEnd ? "justify-end" : "justify-start")}>
          <Button
            onClick={() => {
              setIsExpanded(true);
            }}
            size="sm"
            type="button"
            variant="outline-muted"
          >
            <span className="text-xs">+{hiddenFileCount} more</span>
            <CaretDownIcon className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      )}

      {isExpanded && hasMoreFiles && (
        <div className={cn("flex", alignEnd ? "justify-end" : "justify-start")}>
          <Button
            onClick={() => {
              setIsExpanded(false);
            }}
            size="sm"
            type="button"
            variant="outline-muted"
          >
            <span className="text-xs">Show less</span>
            <CaretUpIcon className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
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
