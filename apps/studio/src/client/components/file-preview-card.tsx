import type { RefObject } from "react";

import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { fileKindLabel, getFileType } from "@/client/lib/get-file-type";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  ArrowLineDownIcon,
  CheckIcon,
  CopyIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useTimedFlag } from "../hooks/use-timed-flag";
import { FileActionsMenu, FileActionsMenuItems } from "./file-actions-menu";
import { FileThumbnail } from "./file-thumbnail";
import { FileVersionBadge } from "./file-version-badge";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
import { ImageWithFallback } from "./image-with-fallback";
import { MediaCardShell } from "./media-card-shell";
import { MediaOverlayButton } from "./media-overlay-button";
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
      <VideoPreviewCard
        file={file}
        handleMouseEnter={handleMouseEnter}
        handleMouseLeave={handleMouseLeave}
        hideActionsMenu={hideActionsMenu}
        isPlaying={isPlaying}
        isSelected={isSelected}
        onClick={onClick}
        onLoadedMetadata={(e) => {
          setVideoDuration(e.currentTarget.duration);
        }}
        onTimeUpdate={(e) => {
          const { currentTime, duration } = e.currentTarget;
          setVideoProgress(duration ? (currentTime / duration) * 100 : 0);
          setTimeRemaining(duration ? duration - currentTime : null);
        }}
        timeRemaining={timeRemaining}
        videoDuration={videoDuration}
        videoProgress={videoProgress}
        videoRef={videoRef}
      />
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
            "group relative flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 transition-colors select-none",
            isSelected
              ? "border border-black/5 bg-brand-600/8 dark:bg-brand-300/8"
              : "bg-card shadow-xs hover:bg-muted/40 dark:border dark:border-black/5 dark:hover:bg-muted/40",
          )}
          onClick={onClick}
        >
          <FileThumbnail
            file={file}
            isActive={isSelected ?? false}
            variant="primary"
          />
          <div className="flex min-w-0 flex-1 flex-col justify-center text-left">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="truncate text-sm leading-5 text-foreground">
                  {filename}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span className="break-all">{filePath}</span>
              </TooltipContent>
            </Tooltip>
            <span className="truncate text-xs leading-[18px] font-medium text-muted-foreground">
              {fileKindLabel(getFileType(file))}
              <FileVersionBadge
                className="ml-1 inline text-[10px]"
                filePath={filePath}
                projectSubdomain={projectSubdomain}
                versionRef={versionRef}
              />
            </span>
          </div>
          {!hideActionsMenu && (
            <div
              className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
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
  const actions = useFileActions(file);
  const { active: copied, trigger: triggerCopied } = useTimedFlag();

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

  const hasActions =
    !hideActionsMenu &&
    (fileActions.showCopy ||
      fileActions.showDownload ||
      fileActions.showReveal);

  return (
    <MediaCardShell
      aspectRatio="square"
      file={file}
      hideActionsMenu={hideActionsMenu}
      isSelected={isSelected}
      onClick={onClick}
      overlayActions={
        hasActions ? (
          <>
            {fileActions.showCopy && (
              <MediaOverlayButton
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
              <MediaOverlayButton
                icon={<ArrowLineDownIcon className="size-3.5 shrink-0" />}
                label="Download"
                onClick={(e) => {
                  e.stopPropagation();
                  void actions.download();
                }}
              />
            )}
            {fileActions.showReveal && (
              <MediaOverlayButton
                icon={<RevealInFolderIcon className="size-3.5 shrink-0" />}
                label={getRevealInFolderLabel()}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.revealInFolder();
                }}
              />
            )}
          </>
        ) : undefined
      }
      scrim={<div className="absolute inset-0 bg-black/20" />}
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
    </MediaCardShell>
  );
}

function useFileActions(file: ProjectFileViewerFile) {
  const showProjectFileInFolderMutation = useMutation(
    rpcClient.utils.showProjectFileInFolder.mutationOptions({
      onError: (error) => {
        const label = getRevealInFolderLabel();
        const lower = label.charAt(0).toLowerCase() + label.slice(1);
        toast.error(`Failed to ${lower}`, { description: error.message });
      },
    }),
  );

  return {
    download: async () => {
      await downloadFile(file);
    },
    revealInFolder: () => {
      showProjectFileInFolderMutation.mutate({
        filePath: file.filePath,
        subdomain: file.projectSubdomain,
      });
    },
  };
}

function VideoPreviewCard({
  file,
  handleMouseEnter,
  handleMouseLeave,
  hideActionsMenu,
  isPlaying,
  isSelected,
  onClick,
  onLoadedMetadata,
  onTimeUpdate,
  timeRemaining,
  videoDuration,
  videoProgress,
  videoRef,
}: {
  file: ProjectFileViewerFile;
  handleMouseEnter: () => void;
  handleMouseLeave: () => void;
  hideActionsMenu?: boolean;
  isPlaying: boolean;
  isSelected?: boolean;
  onClick: () => void;
  onLoadedMetadata: React.ReactEventHandler<HTMLVideoElement>;
  onTimeUpdate: React.ReactEventHandler<HTMLVideoElement>;
  timeRemaining: null | number;
  videoDuration: null | number;
  videoProgress: number;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const fileActions = useFileActionVisibility(file);
  const actions = useFileActions(file);

  const hasActions =
    !hideActionsMenu && (fileActions.showDownload || fileActions.showReveal);

  const displayTime =
    isPlaying && timeRemaining !== null ? timeRemaining : videoDuration;

  return (
    <MediaCardShell
      aspectRatio="video"
      bottomBar={
        displayTime === null ? undefined : (
          <div className="absolute right-4 bottom-4 left-4 z-10 flex flex-col gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <span className="self-end text-xs font-medium text-white tabular-nums drop-shadow-sm">
              {formatTime(displayTime)}
            </span>
            <div className="relative h-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white transition-all duration-100"
                style={{ width: `${videoProgress}%` }}
              />
            </div>
          </div>
        )
      }
      file={file}
      hideActionsMenu={hideActionsMenu}
      isSelected={isSelected}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      overlayActions={
        hasActions ? (
          <>
            {fileActions.showDownload && (
              <MediaOverlayButton
                icon={<ArrowLineDownIcon className="size-3.5 shrink-0" />}
                label="Download"
                onClick={(e) => {
                  e.stopPropagation();
                  void actions.download();
                }}
              />
            )}
            {fileActions.showReveal && (
              <MediaOverlayButton
                icon={<RevealInFolderIcon className="size-3.5 shrink-0" />}
                label={getRevealInFolderLabel()}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.revealInFolder();
                }}
              />
            )}
          </>
        ) : undefined
      }
      scrim={<div className="absolute inset-0 bg-black/20" />}
    >
      <video
        className="size-full bg-black object-contain"
        loop
        muted
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        ref={videoRef}
        src={file.url}
      />
      <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200 group-hover:opacity-0">
        {!isPlaying && (
          <div className="rounded-full bg-background/90 p-2 shadow-lg">
            <PlayIcon
              className="size-4 fill-foreground text-foreground"
              weight="fill"
            />
          </div>
        )}
      </div>
    </MediaCardShell>
  );
}
