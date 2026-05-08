import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { fileKindLabel, getFileType } from "@/client/lib/get-file-type";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  ArrowLineDownIcon,
  ArrowsOutSimpleIcon,
  CheckIcon,
  CopyIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useTimedFlag } from "../hooks/use-timed-flag";
import { FileActionsMenu, FileActionsMenuItems } from "./file-actions-menu";
import { FileIcon } from "./file-icon";
import { FileThumbnail } from "./file-thumbnail";
import { FileVersionBadge } from "./file-version-badge";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
import { ImageWithFallback } from "./image-with-fallback";
import { Badge } from "./ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function FilePreviewCard({
  file,
  hideActionsMenu,
  isSelected,
  onClick,
}: {
  file: ProjectFileViewerFile;
  hideActionsMenu?: boolean;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const { filename, mimeType } = file;
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoTimeoutRef = useRef<null | number>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState<null | number>(null);
  const [videoDuration, setVideoDuration] = useState<null | number>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const fileType = getFileType({ filename, mimeType });

  const handleMouseEnter = () => {
    if (fileType === "video" && videoRef.current) {
      videoTimeoutRef.current = window.setTimeout(() => {
        void videoRef.current?.play();
        setIsPlaying(true);
      }, 500);
    }
  };

  const handleMouseLeave = () => {
    if (fileType === "video" && videoRef.current) {
      if (videoTimeoutRef.current !== null) {
        clearTimeout(videoTimeoutRef.current);
        videoTimeoutRef.current = null;
      }
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  if (fileType === "image") {
    return (
      <ImagePreviewCard
        file={file}
        hideActionsMenu={hideActionsMenu}
        isSelected={isSelected}
        onClick={onClick}
      />
    );
  }

  if (fileType === "video") {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group relative overflow-hidden rounded-lg border border-border bg-background transition-colors hover:bg-muted",
              isSelected &&
                "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="flex w-full items-center gap-2 border-b border-border bg-muted/30 px-2.5 py-1.5">
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={onClick}
                type="button"
              >
                <FileIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  filename={filename}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {filename}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="break-all">{file.filePath}</span>
                  </TooltipContent>
                </Tooltip>
                <FileVersionBadge
                  className="shrink-0 text-[10px]"
                  filePath={file.filePath}
                  projectSubdomain={file.projectSubdomain}
                  versionRef={file.versionRef}
                />
              </button>
              {!hideActionsMenu && <FileActionsMenu file={file} />}
            </div>
            <div className="relative aspect-video w-full overflow-hidden">
              <video
                className="size-full bg-black object-contain"
                loop
                muted
                onLoadedMetadata={(e) => {
                  const video = e.currentTarget;
                  setVideoDuration(video.duration);
                }}
                onTimeUpdate={(e) => {
                  const video = e.currentTarget;
                  const progress = video.duration
                    ? (video.currentTime / video.duration) * 100
                    : 0;
                  setVideoProgress(progress);
                  const remaining = video.duration
                    ? video.duration - video.currentTime
                    : null;
                  setTimeRemaining(remaining);
                }}
                ref={videoRef}
                src={file.url}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity group-hover:opacity-0">
                <div className="rounded-full bg-white/90 p-2 shadow-lg">
                  <PlayIcon
                    className="size-4 fill-black text-black"
                    weight="fill"
                  />
                </div>
              </div>
              {(isPlaying
                ? timeRemaining !== null && timeRemaining > 0
                : videoDuration !== null) && (
                <div className="absolute right-2 bottom-2">
                  <Badge
                    className="bg-black/70 text-white hover:bg-black/70"
                    variant="secondary"
                  >
                    {formatTime(
                      isPlaying && timeRemaining !== null
                        ? timeRemaining
                        : (videoDuration ?? 0),
                    )}
                  </Badge>
                </div>
              )}
              {isPlaying && (
                <div className="absolute right-0 bottom-0 left-0 h-1 bg-black/50">
                  <div
                    className="h-full bg-white transition-all duration-100"
                    style={{ width: `${videoProgress}%` }}
                  />
                </div>
              )}
              <button
                className="absolute inset-0 size-full"
                onClick={onClick}
                type="button"
              />
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <FileActionsMenuItems file={file} variant="context" />
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <FileRowCard
      file={file}
      hideActionsMenu={hideActionsMenu}
      isSelected={isSelected}
      onClick={onClick}
    />
  );
}

function FileRowCard({
  file,
  hideActionsMenu,
  isSelected,
  onClick,
}: {
  file: ProjectFileViewerFile;
  hideActionsMenu?: boolean;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const { filename, filePath, projectSubdomain, versionRef } = file;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative flex h-auto min-h-14 items-stretch gap-2.5 overflow-hidden rounded-lg border border-border bg-background px-3 py-2 text-xs",
            "transition-colors hover:bg-muted/50",
            isSelected && "border-primary/30 bg-primary/10 hover:bg-primary/15",
          )}
        >
          <FileThumbnail
            file={file}
            isActive={isSelected ?? false}
            variant="primary"
          />
          <button
            className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 text-left"
            onClick={onClick}
            type="button"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "truncate font-medium",
                    isSelected ? "text-primary" : "text-foreground",
                  )}
                >
                  {filename}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span className="break-all">{filePath}</span>
              </TooltipContent>
            </Tooltip>
            <span
              className={cn(
                "truncate",
                isSelected ? "text-primary/70" : "text-muted-foreground",
              )}
            >
              {fileKindLabel(getFileType(file))}
              <FileVersionBadge
                className="ml-1 inline text-[10px]"
                filePath={filePath}
                projectSubdomain={projectSubdomain}
                versionRef={versionRef}
              />
            </span>
          </button>
          {!hideActionsMenu && (
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
              <FileActionsMenu file={file} />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <FileActionsMenuItems file={file} variant="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function ImageOverlayButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-lg bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-background dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function ImagePreviewCard({
  file,
  hideActionsMenu,
  isSelected,
  onClick,
}: {
  file: ProjectFileViewerFile;
  hideActionsMenu?: boolean;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const { filename, mimeType, url } = file;
  const fileActions = useFileActionVisibility(file);
  const { active: copied, trigger: triggerCopied } = useTimedFlag();

  const showProjectFileInFolderMutation = useMutation(
    rpcClient.utils.showProjectFileInFolder.mutationOptions({
      onError: (error) => {
        const label = getRevealInFolderLabel();
        const lowercasedLabel = label.charAt(0).toLowerCase() + label.slice(1);
        toast.error(`Failed to ${lowercasedLabel}`, {
          description: error.message,
        });
      },
    }),
  );

  const handleCopy = async () => {
    try {
      await copyFileToClipboard({
        filePath: file.filePath,
        isImage: mimeType.startsWith("image/"),
        subdomain: file.projectSubdomain,
        versionRef: file.versionRef,
      });
      triggerCopied();
    } catch {
      // copyFileToClipboard already toasts on error
    }
  };

  const handleDownload = async () => {
    await downloadFile(file);
  };

  const handleRevealInFolder = () => {
    showProjectFileInFolderMutation.mutate({
      filePath: file.filePath,
      subdomain: file.projectSubdomain,
    });
  };

  const hasActions =
    !hideActionsMenu &&
    (fileActions.showCopy ||
      fileActions.showDownload ||
      fileActions.showReveal);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative aspect-square w-full overflow-hidden rounded-2xl bg-card shadow-sm dark:bg-muted",
            isSelected &&
              "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <div className="flex size-full items-center justify-center">
            <ImageWithFallback
              alt={filename}
              className="max-h-full max-w-full object-contain"
              fallbackClassName="size-full"
              filename={filename}
              showCheckerboard
              src={url}
            />
          </div>

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/75 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

          <button
            className="absolute inset-0 z-0 size-full"
            onClick={onClick}
            type="button"
          />

          {!hideActionsMenu && (
            <button
              className={cn(
                "absolute top-3 right-3 z-10 flex size-7 items-center justify-center rounded-lg",
                "bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity duration-200",
                "group-hover:opacity-100 hover:bg-background dark:bg-white/5 dark:text-white dark:hover:bg-white/10",
              )}
              onClick={onClick}
              type="button"
            >
              <ArrowsOutSimpleIcon className="size-3.5" />
            </button>
          )}

          {hasActions && (
            <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              {fileActions.showCopy && (
                <ImageOverlayButton
                  icon={
                    copied ? (
                      <CheckIcon className="size-3.5 shrink-0" />
                    ) : (
                      <CopyIcon className="size-3.5 shrink-0" />
                    )
                  }
                  label="Copy"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopy();
                  }}
                />
              )}
              {fileActions.showDownload && (
                <ImageOverlayButton
                  icon={<ArrowLineDownIcon className="size-3.5 shrink-0" />}
                  label="Download"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDownload();
                  }}
                />
              )}
              {fileActions.showReveal && (
                <ImageOverlayButton
                  icon={<RevealInFolderIcon className="size-3.5 shrink-0" />}
                  label={getRevealInFolderLabel()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRevealInFolder();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <FileActionsMenuItems file={file} variant="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}
