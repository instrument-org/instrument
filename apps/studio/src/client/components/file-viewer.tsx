import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { getLanguageFromFilePath } from "@/client/lib/file-extension-to-language";
import { getFileType } from "@/client/lib/get-file-type";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  ArrowLineDownIcon,
  ArrowsInIcon,
  ArrowsOutSimpleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
  EyeIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { tv } from "tailwind-variants";

import { useFileActionVisibility } from "../hooks/use-file-action-visibility";
import {
  IMAGE_PANZOOM_VIEWPORT_CLASS,
  useImagePanzoom,
} from "../hooks/use-image-panzoom";
import { useSyntaxHighlighting } from "../hooks/use-syntax-highlighting";
import { useTimedFlag } from "../hooks/use-timed-flag";
import { FileActionsMenuItems } from "./file-actions-menu";
import { FilePreviewFallback } from "./file-preview-fallback";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
import { ImageWithFallback } from "./image-with-fallback";
import { SandboxedHtmlIframe } from "./sandboxed-html-iframe";
import { SessionMarkdown } from "./session-markdown";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { contextMenuComponents } from "./ui/menu-components";
import { Spinner } from "./ui/spinner";
import { toolbarClassName } from "./ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

function ImagePanzoomViewer({
  filename,
  onError,
  url,
}: {
  filename: string;
  onError: () => void;
  url: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { canReset, reset, zoomIn, zoomOut } = useImagePanzoom({
    contentRef,
    viewportRef,
  });

  return (
    <div className={`${IMAGE_PANZOOM_VIEWPORT_CLASS} relative size-full`}>
      <div
        className="flex size-full items-center justify-center overflow-hidden"
        ref={viewportRef}
      >
        <div
          className="flex items-center justify-center"
          ref={contentRef}
          style={{ height: "100%", width: "100%" }}
        >
          <ImageWithFallback
            alt={filename}
            className="size-auto max-h-full max-w-full object-contain select-none"
            filename={filename}
            onError={onError}
            showCheckerboard
            src={url}
          />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="pointer-events-auto">
          <ImageZoomControls
            canReset={canReset}
            onReset={reset}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
        </div>
      </div>
    </div>
  );
}

function ImageZoomControls({
  canReset,
  onReset,
  onZoomIn,
  onZoomOut,
}: {
  canReset: boolean;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-background/90 p-1 text-foreground shadow-lg">
      <Button onClick={onZoomOut} size="icon-sm" variant="ghost">
        <MagnifyingGlassMinusIcon className="size-5" />
      </Button>
      <Button onClick={onZoomIn} size="icon-sm" variant="ghost">
        <MagnifyingGlassPlusIcon className="size-5" />
      </Button>
      {canReset && (
        <Button onClick={onReset} size="icon-sm" variant="ghost">
          <ArrowsInIcon className="size-5" />
        </Button>
      )}
    </div>
  );
}

function MarkdownPreview({ url }: { url: string }) {
  const { data, error, isLoading } = useQuery({
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    queryKey: ["markdown-file", url],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex size-full items-center justify-center">
        <Spinner className="size-8 text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex size-full items-center justify-center p-8">
        <Alert className="max-w-2xl" variant="destructive">
          <AlertTitle>Failed to load file</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "An unknown error occurred"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <SessionMarkdown className="p-8" markdown={data ?? ""} />;
}

function TextView({
  children,
  filename,
  url,
}: {
  children: (text: string) => ReactNode;
  filename: string;
  url: string;
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    queryKey: ["text-file", url],
    retry: false, // Ensures fast failure
  });

  const language = getLanguageFromFilePath(filename);
  const { highlightedHtml } = useSyntaxHighlighting({
    code: language ? data : undefined,
    language,
  });

  if (isLoading) {
    return (
      <div className="flex size-full items-center justify-center">
        <Spinner className="size-8 text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex size-full items-center justify-center p-8">
        <Alert className="max-w-2xl" variant="destructive">
          <AlertTitle>Failed to load file</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "An unknown error occurred"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (highlightedHtml) {
    return (
      <div
        className="p-4 text-sm"
        dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
      />
    );
  }

  if (language) {
    // Delay showing plain text fallback to give syntax highlighting time to load
    return (
      <motion.div
        animate={{ opacity: 1 }}
        initial={{ opacity: 0 }}
        transition={{ delay: 0.3, duration: 0 }}
      >
        {children(data ?? "")}
      </motion.div>
    );
  }

  return <>{children(data ?? "")}</>;
}

const fileViewerVariants = tv({
  base: "flex w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm",
  defaultVariants: {
    error: false,
    fileType: "default",
    fullSize: false,
  },
  variants: {
    error: {
      true: "h-auto max-w-2xl!",
    },
    fileType: {
      audio: "h-auto max-w-2xl",
      default: "h-[80vh] max-w-4xl",
      html: "h-[80vh] max-w-6xl",
      text: "h-[70vh] max-w-4xl",
    },
    fullSize: {
      true: "h-full max-w-none!",
    },
  },
});

const fileViewerHeaderActionClassName = toolbarClassName({
  className: "h-7 gap-1.5 px-2 text-xs has-[>svg]:px-2",
  pressed: false,
});

const fileViewerHeaderIconActionClassName = toolbarClassName({
  className: "size-7",
  pressed: false,
});

const fileViewerHeaderMenuTriggerClassName = toolbarClassName({
  className:
    "size-7 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
  pressed: false,
});

export function FileViewer({
  file,
  fullSize = false,
  onClose,
  onExpand,
}: {
  file: TaskFileViewerFile;
  fullSize?: boolean;
  onClose: () => void;
  onExpand?: () => void;
}) {
  const { filename, filePath, mimeType, taskId, url } = file;
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const [mediaErrorType, setMediaErrorType] = useState<string | undefined>();
  const [imageErrorUrl, setImageErrorUrl] = useState<null | string>(null);
  const imageLoadError = imageErrorUrl === url;
  const contentRef = useRef<HTMLDivElement>(null);
  const { active: copied, trigger: triggerCopied } = useTimedFlag();
  const revealFileMutation = useMutation(
    rpcClient.utils.showTaskFileInFolder.mutationOptions({
      onError: (error) => {
        const label = getRevealInFolderLabel();
        const lowercasedLabel = label.charAt(0).toLowerCase() + label.slice(1);
        toast.error(`Failed to ${lowercasedLabel}`, {
          description: error.message,
        });
      },
    }),
  );

  useEffect(() => {
    contentRef.current?.scrollTo({ behavior: "instant", top: 0 });
  }, [viewMode]);

  const fileType = getFileType(file);
  const hasPreview = fileType === "markdown" || fileType === "html";
  const fileActions = useFileActionVisibility(file);
  const hasHeaderMenuActions = onExpand != null || fileActions.showReveal;
  const showOverflowMenu =
    fileActions.showReveal || hasPreview || Boolean(onExpand);

  const handleDownload = async () => {
    await downloadFile(file);
  };

  const handleCopy = async () => {
    try {
      await copyFileToClipboard({
        filePath,
        id: taskId,
        isImage: mimeType.startsWith("image/"),
      });
      triggerCopied();
    } catch {
      // copyFileToClipboard already toasts on error
    }
  };

  const handleViewModeChange = (value: string) => {
    if (value === "preview" || value === "raw") {
      setViewMode(value);
    }
  };

  const handleRevealInFolder = () => {
    revealFileMutation.mutate({
      filePath,
      id: taskId,
    });
  };

  const getViewerLayoutType = () => {
    if (fileType === "audio") {
      return "audio";
    }
    if (fileType === "code" || fileType === "text") {
      return "text";
    }
    if (fileType === "html" && !mediaLoadError) {
      return "html";
    }
    return "default";
  };

  return (
    <div
      className={fileViewerVariants({
        error: false,
        fileType: getViewerLayoutType(),
        fullSize,
      })}
    >
      <div className="@container flex min-w-0 shrink-0 items-center gap-2 px-4 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 truncate text-xs font-medium">
              {filename}
            </span>
          </TooltipTrigger>
          <TooltipContent
            className="max-w-[min(500px,90vw)] wrap-break-word"
            collisionPadding={10}
          >
            {filePath}
          </TooltipContent>
        </Tooltip>
        <div className="ml-auto flex min-w-7 shrink items-center justify-end gap-1 overflow-hidden">
          {fileActions.showDownload && (
            <Button
              className={fileViewerHeaderActionClassName}
              onClick={() => void handleDownload()}
              size="sm"
              variant="ghost"
            >
              <ArrowLineDownIcon className="size-4" />
              <span className="hidden min-w-0 truncate @min-[380px]:inline">
                Download
              </span>
            </Button>
          )}
          {fileActions.showCopy && (
            <Button
              className={fileViewerHeaderActionClassName}
              onClick={() => void handleCopy()}
              size="sm"
              variant="ghost"
            >
              {copied ? (
                <CheckIcon className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
              <span className="hidden min-w-0 truncate @min-[380px]:inline">
                Copy
              </span>
            </Button>
          )}
          {showOverflowMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className={fileViewerHeaderMenuTriggerClassName}
                  size="icon-sm"
                  variant="ghost"
                >
                  <DotsThreeOutlineVerticalIcon
                    className="size-4"
                    weight="fill"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onExpand && (
                  <DropdownMenuItem onClick={onExpand}>
                    <ArrowsOutSimpleIcon className="size-4" />
                    <span>Expand</span>
                  </DropdownMenuItem>
                )}
                {fileActions.showReveal && (
                  <DropdownMenuItem onClick={handleRevealInFolder}>
                    <RevealInFolderIcon className="size-4" />
                    <span>{getRevealInFolderLabel()}</span>
                  </DropdownMenuItem>
                )}
                {hasHeaderMenuActions && hasPreview && (
                  <DropdownMenuSeparator />
                )}
                {hasPreview && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {viewMode === "preview" ? (
                        <EyeIcon className="size-4" />
                      ) : (
                        <CodeIcon className="size-4" />
                      )}
                      <span>View mode</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-36">
                      <DropdownMenuRadioGroup
                        onValueChange={handleViewModeChange}
                        value={viewMode}
                      >
                        <DropdownMenuRadioItem value="preview">
                          <EyeIcon className="size-4" />
                          <span>Preview</span>
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="raw">
                          <CodeIcon className="size-4" />
                          <span>Code</span>
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            className={fileViewerHeaderIconActionClassName}
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto" ref={contentRef}>
        {mediaLoadError ? (
          <div className="flex size-full items-center justify-center">
            <FilePreviewFallback
              fallbackExtension={mediaErrorType}
              filename={filename}
              onDownload={fileActions.showDownload ? handleDownload : undefined}
            />
          </div>
        ) : fileType === "markdown" && viewMode === "preview" ? (
          <MarkdownPreview url={url} />
        ) : fileType === "html" && viewMode === "preview" ? (
          <SandboxedHtmlIframe
            className="absolute inset-0 size-full border-0"
            src={url}
            title={filename}
          />
        ) : fileType === "image" ? (
          imageLoadError ? (
            <div className="flex size-full items-center justify-center">
              <FilePreviewFallback
                fallbackExtension="jpg"
                filename={filename}
                onDownload={
                  fileActions.showDownload ? handleDownload : undefined
                }
              />
            </div>
          ) : (
            <ContextMenu>
              <ContextMenuTrigger className="size-full">
                <ImagePanzoomViewer
                  filename={filename}
                  key={url}
                  onError={() => {
                    setImageErrorUrl(url);
                  }}
                  url={url}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <FileActionsMenuItems
                  file={file}
                  menuComponents={contextMenuComponents}
                />
              </ContextMenuContent>
            </ContextMenu>
          )
        ) : fileType === "code" ||
          fileType === "text" ||
          (fileType === "html" && viewMode === "raw") ||
          (fileType === "markdown" && viewMode === "raw") ? (
          <TextView filename={filename} url={url}>
            {(text) => (
              <pre className="p-4 text-sm text-foreground">{text}</pre>
            )}
          </TextView>
        ) : fileType === "pdf" ? (
          <iframe
            className="absolute inset-0 size-full border-0"
            key={url}
            onError={() => {
              setMediaLoadError(true);
              setMediaErrorType("pdf");
            }}
            src={`${url}#navpanes=0`}
            title={filename}
          />
        ) : fileType === "video" ? (
          <video
            className="size-full object-contain"
            controls
            key={url}
            onError={() => {
              setMediaLoadError(true);
              setMediaErrorType("mp4");
            }}
            src={url}
          />
        ) : fileType === "audio" ? (
          <div className="flex size-full items-center justify-center p-8">
            <audio
              className="w-full"
              controls
              key={url}
              onError={() => {
                setMediaLoadError(true);
                setMediaErrorType("mp3");
              }}
              src={url}
            />
          </div>
        ) : (
          <div className="flex size-full items-center justify-center">
            <FilePreviewFallback
              fallbackExtension="bin"
              filename={filename}
              onDownload={fileActions.showDownload ? handleDownload : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
