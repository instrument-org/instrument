import type { RefObject } from "react";

import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { useTaskFileOpenControl } from "@/client/hooks/use-task-file-open-control";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { getFileKindLabel, getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import {
  ArrowLineDownIcon,
  CheckIcon,
  CopyIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { usePrefetchTaskFileOpenTarget } from "../hooks/use-task-file-open-target";
import { useTimedFlag } from "../hooks/use-timed-flag";
import { FileActionsMenu, FileActionsMenuItems } from "./file-actions-menu";
import { FileThumbnail } from "./file-thumbnail";
import { ImageWithFallback } from "./image-with-fallback";
import { MediaCardShell } from "./media-card-shell";
import { MediaOverlayButton } from "./media-overlay-button";
import { OpenTaskFileButton } from "./open-task-file-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function FilePreviewCard({
  file,
  hideActionsMenu,
  isSelected,
  onClick,
}: {
  file: TaskFileViewerFile;
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
  file: TaskFileViewerFile;
  hideActionsMenu?: boolean;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const { filename, filePath } = file;
  const fileActions = useFileActionVisibility(file);
  const hasFileActions =
    fileActions.showCopy ||
    fileActions.showDownload ||
    fileActions.showOpen ||
    fileActions.showReveal;
  const prefetchOpenTarget = usePrefetchTaskFileOpenTarget();

  const row = (
    <div
      className={cn(
        "group relative flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 select-none",
        isSelected
          ? "border border-black/5 bg-brand-600/8 dark:bg-brand-300/8"
          : "bg-card shadow-xs hover:bg-muted/40 dark:border dark:border-black/5 dark:hover:bg-muted/40",
      )}
      onClick={onClick}
      onMouseEnter={() => {
        prefetchOpenTarget(file);
      }}
    >
      {/* The row is what opens the file, and a row is not a control: without
          this it could be clicked and nothing else -- no tab stop, no name, no
          Enter. It carries no handler of its own, so a press here activates the
          same way a press on the filename does, by reaching the row's `onClick`
          on the way up. Below the text column in paint order, so the tooltip
          and the actions menu still take the pointer first. */}
      <button
        aria-label={`Open ${filename}`}
        className="absolute inset-0 z-0 size-full rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        type="button"
      />
      <FileThumbnail
        file={file}
        isActive={isSelected ?? false}
        variant="primary"
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center text-left">
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
          {getFileKindLabel(file)}
        </span>
      </div>
      {!hideActionsMenu && hasFileActions && (
        <div
          className="relative z-10 flex shrink-0 items-center opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <FileActionsMenu file={file} />
        </div>
      )}
    </div>
  );

  if (!hasFileActions) {
    return row;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <FileActionsMenuItems
          file={file}
          menuComponents={contextMenuComponents}
        />
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
  file: TaskFileViewerFile;
  hideActionsMenu?: boolean;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const { filename, url } = file;
  const fileActions = useFileActionVisibility(file);
  const [resolveOpenTarget, setResolveOpenTarget] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const openControl = useTaskFileOpenControl(
    resolveOpenTarget ? file : undefined,
  );
  const { active: copied, trigger: triggerCopied } = useTimedFlag();
  const showCopy = fileActions.showCopy && !imageLoadError;

  const handleCopy = async () => {
    try {
      await copyFileToClipboard({
        filePath: file.filePath,
        id: file.taskId,
        isImage: getFileType(file) === "image",
      });
      triggerCopied();
    } catch {
      // copyFileToClipboard already toasts on error
    }
  };

  const hasActions =
    !hideActionsMenu &&
    (showCopy || fileActions.showDownload || openControl.showOpen);

  return (
    <MediaCardShell
      canCopy={!imageLoadError}
      file={file}
      hideActionsMenu={hideActionsMenu}
      isSelected={isSelected}
      onClick={onClick}
      onMouseEnter={() => {
        setResolveOpenTarget(true);
      }}
      overlayActions={
        hasActions ? (
          <>
            {showCopy && (
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
                label="Save as…"
                onClick={(e) => {
                  e.stopPropagation();
                  void downloadFile(file);
                }}
              />
            )}
            <OpenTaskFileButton
              className="max-w-44"
              control={openControl}
              dropdownClassName="h-6 rounded-lg"
              file={file}
              iconClassName="size-3.5 shrink-0"
              labelClassName="truncate"
              onClick={(e) => {
                e.stopPropagation();
              }}
              size="xs"
            />
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
          onError={() => {
            setImageLoadError(true);
          }}
          showCheckerboard
          src={url}
        />
      </div>
    </MediaCardShell>
  );
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
  file: TaskFileViewerFile;
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
  const { url } = file;
  const fileActions = useFileActionVisibility(file);
  const [resolveOpenTarget, setResolveOpenTarget] = useState(false);
  const openControl = useTaskFileOpenControl(
    resolveOpenTarget ? file : undefined,
  );

  const hasActions =
    !hideActionsMenu && (fileActions.showDownload || openControl.showOpen);

  const displayTime =
    isPlaying && timeRemaining !== null ? timeRemaining : videoDuration;

  return (
    <MediaCardShell
      bottomBar={
        displayTime === null ? undefined : (
          <div className="pointer-events-none absolute right-4 bottom-4 left-4 z-10 flex flex-col gap-1 opacity-0 transition-opacity duration-200 group-hover/media:opacity-100">
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
      onMouseEnter={() => {
        setResolveOpenTarget(true);
        handleMouseEnter();
      }}
      onMouseLeave={handleMouseLeave}
      overlayActions={
        hasActions ? (
          <>
            {fileActions.showDownload && (
              <MediaOverlayButton
                icon={<ArrowLineDownIcon className="size-3.5 shrink-0" />}
                label="Save as…"
                onClick={(e) => {
                  e.stopPropagation();
                  void downloadFile(file);
                }}
              />
            )}
            <OpenTaskFileButton
              className="max-w-44"
              control={openControl}
              dropdownClassName="h-6 rounded-lg"
              file={file}
              iconClassName="size-3.5 shrink-0"
              labelClassName="truncate"
              onClick={(e) => {
                e.stopPropagation();
              }}
              size="xs"
            />
          </>
        ) : undefined
      }
      scrim={<div className="absolute inset-0 bg-black/20" />}
    >
      {/* No surface of its own: the card's is what shows around a frame that
          does not fill the square, the same as an image's. A black box would
          be the heaviest thing in the reply, and next to the image tiles it
          sits beside it reads as a different component rather than a
          different kind of file. */}
      <video
        className="size-full object-contain"
        loop
        muted
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        ref={videoRef}
        src={url}
      />
      <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200 group-hover/media:opacity-0">
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
