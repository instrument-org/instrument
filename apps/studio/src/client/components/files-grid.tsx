import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { getFileType } from "@/client/lib/get-file-type";
import { isUnknownTopLevelDirFile } from "@/client/lib/project-file-groups";
import { cn } from "@/client/lib/utils";
import { type ArtifactPanel } from "@/client/schemas/artifact-panel";
import { APP_FOLDER_NAMES } from "@instrument-org/workspace/client";
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
  files: ProjectFileViewerFile[];
  folders?: SessionMessageDataPart.FolderAttachmentDataPart[];
  initialVisibleCount?: number;
  prioritizeUserFiles?: boolean;
}

type SupportingSectionKey =
  | "agentRetrieved"
  | "other"
  | "scripts"
  | "skills"
  | "temporary";

const DEFAULT_INITIAL_VISIBLE_COUNT = 6;
const EMPTY_FOLDERS: SessionMessageDataPart.FolderAttachmentDataPart[] = [];
const DEFAULT_EXPANDED_SECTIONS: Record<SupportingSectionKey, boolean> = {
  agentRetrieved: false,
  other: false,
  scripts: false,
  skills: false,
  temporary: false,
};
const EXPANDED_SECTIONS: Record<SupportingSectionKey, boolean> = {
  agentRetrieved: true,
  other: true,
  scripts: true,
  skills: true,
  temporary: true,
};

export function FilesGrid({
  alignEnd = false,
  compact = false,
  files,
  folders = EMPTY_FOLDERS,
  initialVisibleCount = DEFAULT_INITIAL_VISIBLE_COUNT,
  prioritizeUserFiles = false,
}: FilesGridProps) {
  const navigate = useNavigate({ from: "/projects/$subdomain" });
  const search = useSearch({
    from: "/_app/projects/$subdomain/",
    shouldThrow: false,
  });
  const selectedArtifactFile =
    search?.artifactPanel?.type === "file" ? search.artifactPanel : null;

  const handleFileClick = (file: ProjectFileViewerFile) => {
    if (!search) {
      return;
    }
    const filePath = normalizeProjectFilePath(file.filePath);
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: {
          filePath,
          fileVersion: file.versionRef,
          type: "file",
        },
      }),
    });
  };

  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState(
    DEFAULT_EXPANDED_SECTIONS,
  );

  const [outputFiles, nonOutputFiles] = fork(files, isOutputFile);
  const [userProvidedFiles, nonUserProvidedFiles] = fork(
    nonOutputFiles,
    isUserProvidedFile,
  );
  const [supportingFilesByKey, regularFiles] =
    splitSupportingFiles(nonUserProvidedFiles);

  const sortedOutputFiles = sortByRichPreview(outputFiles);
  const sortedRegularFiles = sortByRichPreview(regularFiles);
  const sortedUserProvidedFiles = sortByRichPreview(userProvidedFiles);

  const mainFiles = prioritizeUserFiles
    ? [...sortedUserProvidedFiles, ...sortedOutputFiles, ...sortedRegularFiles]
    : [...sortedOutputFiles, ...sortedRegularFiles, ...sortedUserProvidedFiles];

  const visibleMainFiles = mainFiles.slice(0, initialVisibleCount);
  const supportingSections = [
    {
      files: supportingFilesByKey.scripts,
      key: "scripts" as const,
      title: "Scripts",
    },
    {
      files: supportingFilesByKey.skills,
      key: "skills" as const,
      title: "Skills",
    },
    {
      files: supportingFilesByKey.temporary,
      key: "temporary" as const,
      title: "Temporary",
    },
    {
      files: supportingFilesByKey.agentRetrieved,
      key: "agentRetrieved" as const,
      title: "Agent Retrieved",
    },
    {
      files: supportingFilesByKey.other,
      key: "other" as const,
      title: "Other Files",
    },
  ];
  const supportingFileCount = supportingSections.reduce((count, section) => {
    return count + section.files.length;
  }, 0);

  const hasMoreFiles =
    mainFiles.length > initialVisibleCount || supportingFileCount > 0;

  const expandedFiles = mainFiles.slice(initialVisibleCount);

  const hiddenFileCount = expandedFiles.length + supportingFileCount;

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
              const nonEmptySections = supportingSections.filter(
                (s) => s.files.length > 0,
              );
              if (outputFiles.length === 0 || nonEmptySections.length === 1) {
                setExpandedSections(EXPANDED_SECTIONS);
              }
            }}
            size="sm"
            type="button"
            variant="outline-muted"
          >
            {expandedFiles.length > 0 ? (
              <span className="text-xs">+{hiddenFileCount} more</span>
            ) : (
              <span className="text-xs">
                Show {hiddenFileCount} supporting file
                {hiddenFileCount === 1 ? "" : "s"}
              </span>
            )}
            <CaretDownIcon className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      )}

      {isExpanded &&
        supportingSections.map((section) => {
          if (section.files.length === 0) {
            return null;
          }

          return (
            <CategorizedFileSection
              alignEnd={alignEnd}
              files={section.files}
              isExpanded={expandedSections[section.key]}
              key={section.key}
              onFileClick={handleFileClick}
              onToggle={() => {
                setExpandedSections((prev) => ({
                  ...prev,
                  [section.key]: !prev[section.key],
                }));
              }}
              selectedArtifactFile={selectedArtifactFile}
              title={section.title}
            />
          );
        })}

      {isExpanded && (
        <div className={cn("flex", alignEnd ? "justify-end" : "justify-start")}>
          <Button
            onClick={() => {
              setIsExpanded(false);
              setExpandedSections(DEFAULT_EXPANDED_SECTIONS);
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

function CategorizedFileSection({
  alignEnd,
  files,
  isExpanded,
  onFileClick,
  onToggle,
  selectedArtifactFile,
  title,
}: {
  alignEnd: boolean;
  files: ProjectFileViewerFile[];
  isExpanded: boolean;
  onFileClick: (file: ProjectFileViewerFile) => void;
  onToggle: () => void;
  selectedArtifactFile: Extract<ArtifactPanel, { type: "file" }> | null;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/50 bg-muted/30 p-2">
      <button
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
        type="button"
      >
        {isExpanded ? (
          <CaretUpIcon className="size-3" />
        ) : (
          <CaretDownIcon className="size-3" />
        )}
        <span>
          {title} ({files.length})
        </span>
      </button>

      {isExpanded && (
        <div
          className={cn(
            "flex flex-wrap items-start gap-2",
            alignEnd && "justify-end",
          )}
        >
          {files.map((file) => (
            <div className="h-12 max-w-48 min-w-0" key={file.filePath}>
              <FilePreviewListItem
                file={file}
                isSelected={isArtifactPanelFileSelected(
                  file,
                  selectedArtifactFile,
                )}
                onClick={() => {
                  onFileClick(file);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function hasMediaPreview(file: ProjectFileViewerFile) {
  const fileType = getFileType(file);
  return fileType === "image" || fileType === "video";
}

function hasRowCardPreview(file: ProjectFileViewerFile) {
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

function isAgentRetrievedFile(file: ProjectFileViewerFile) {
  return normalizeProjectFilePath(file.filePath).startsWith(
    `${APP_FOLDER_NAMES.agentRetrieved}/`,
  );
}

function isArtifactPanelFileSelected(
  file: ProjectFileViewerFile,
  artifactPanel: Extract<ArtifactPanel, { type: "file" }> | null,
) {
  if (!artifactPanel) {
    return false;
  }

  if (
    normalizeProjectFilePath(file.filePath) !==
    normalizeProjectFilePath(artifactPanel.filePath)
  ) {
    return false;
  }

  if (artifactPanel.fileVersion !== undefined) {
    return file.versionRef === artifactPanel.fileVersion;
  }

  return true;
}

function isOutputFile(file: ProjectFileViewerFile) {
  return normalizeProjectFilePath(file.filePath).startsWith(
    `${APP_FOLDER_NAMES.output}/`,
  );
}

function isScriptFile(file: ProjectFileViewerFile) {
  return normalizeProjectFilePath(file.filePath).startsWith(
    `${APP_FOLDER_NAMES.scripts}/`,
  );
}

function isSkillFile(file: ProjectFileViewerFile) {
  return normalizeProjectFilePath(file.filePath).startsWith(
    `${APP_FOLDER_NAMES.skills}/`,
  );
}

function isTempFile(file: ProjectFileViewerFile) {
  return normalizeProjectFilePath(file.filePath).startsWith("tmp/");
}

function isUserProvidedFile(file: ProjectFileViewerFile) {
  return normalizeProjectFilePath(file.filePath).startsWith(
    `${APP_FOLDER_NAMES.userProvided}/`,
  );
}

function normalizeProjectFilePath(filePath: string) {
  return filePath.startsWith("./") ? filePath.slice(2) : filePath;
}

function sortByRichPreview(files: ProjectFileViewerFile[]) {
  const [media, rest] = fork(files, hasMediaPreview);
  const [rowCard, other] = fork(rest, hasRowCardPreview);
  return [...media, ...rowCard, ...other];
}

function splitSupportingFiles(files: ProjectFileViewerFile[]) {
  const supportingFilesByKey: Record<
    SupportingSectionKey,
    ProjectFileViewerFile[]
  > = {
    agentRetrieved: [],
    other: [],
    scripts: [],
    skills: [],
    temporary: [],
  };

  let remainingFiles = files;
  const matchingOrder: {
    key: SupportingSectionKey;
    matches: (file: ProjectFileViewerFile) => boolean;
  }[] = [
    { key: "scripts", matches: isScriptFile },
    { key: "skills", matches: isSkillFile },
    { key: "temporary", matches: isTempFile },
    { key: "agentRetrieved", matches: isAgentRetrievedFile },
    {
      key: "other",
      matches: (f) =>
        isUnknownTopLevelDirFile(normalizeProjectFilePath(f.filePath)),
    },
  ];

  for (const { key, matches } of matchingOrder) {
    const [matchedFiles, unmatchedFiles] = fork(remainingFiles, matches);
    supportingFilesByKey[key] = matchedFiles;
    remainingFiles = unmatchedFiles;
  }

  return [supportingFilesByKey, remainingFiles] as const;
}
