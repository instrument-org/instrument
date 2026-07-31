import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import {
  LazyCsvViewer,
  LazyDocxViewer,
  LazyPdfViewer,
  LazyPptxViewer,
  LazyXlsxViewer,
} from "@/client/lib/document-viewers";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { getLanguageFromFilePath } from "@/client/lib/file-extension-to-language";
import { type FileType, getFileType } from "@/client/lib/get-file-type";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  ArrowClockwiseIcon,
  ArrowLineDownIcon,
  ArrowsOutSimpleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
  EyeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useFileActionVisibility } from "../hooks/use-file-action-visibility";
import { useSyntaxHighlighting } from "../hooks/use-syntax-highlighting";
import { useTaskFileOpenControl } from "../hooks/use-task-file-open-control";
import { useTimedFlag } from "../hooks/use-timed-flag";
import { ViewerSurface } from "./document-viewers/viewer-surface";
import { FileActionsMenuItems } from "./file-actions-menu";
import { FileLoading } from "./file-loading";
import { FilePreviewFallback } from "./file-preview-fallback";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
import { ImageViewer } from "./image-viewer";
import { OpenTaskFileButton } from "./open-task-file-button";
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
import { toolbarClassName } from "./ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
    return <FileLoading />;
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
  const { highlightedHtml, isHighlightable } = useSyntaxHighlighting({
    code: data,
    language,
  });

  if (isLoading) {
    return <FileLoading />;
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

  if (isHighlightable) {
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

// Both hosts (the artifact panel and the expand modal) give the viewer the
// space they have, so there is no intrinsic-size variant left to pick.
const fileViewerClassName =
  "flex h-full w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm";

interface ViewerContext {
  fallback: ReactNode;
  file: TaskFileViewerFile;
  htmlReloadNonce: number;
  imageLoadError: boolean;
  onImageError: () => void;
  onMediaError: (fallbackExtension: string) => void;
  viewMode: "preview" | "raw";
}

/**
 * How a file type reaches the screen.
 *
 * `scrolls: "self"` means the viewer manages its own scrolling and fills the
 * content area; the others sit inside the shared scroll container. Declared as
 * an exhaustive record so a new `FileType` is a type error until it is routed.
 *
 * Only images and video wrap themselves in our own context menu. The document
 * viewers deliberately do not, and it is worth saying why, because supplying
 * one looks like an improvement until you use it: our menu suppresses the
 * native one, so right-clicking a selection loses Copy and Look Up and offers
 * Open With and Save As in their place -- actions about the file, presented as
 * though they were about the text just highlighted. That is worse than a menu
 * with less in it. Formats whose selection the browser cannot see keep a
 * keyboard copy binding inside their own viewer instead.
 */
interface ViewerEntry {
  render: (context: ViewerContext) => ReactNode;
  scrolls: "container" | "self";
}

const VIEWERS = {
  audio: {
    render: ({ file, onMediaError }) => (
      <div className="flex size-full items-center justify-center p-8">
        <audio
          className="w-full max-w-2xl"
          controls
          key={file.url}
          onError={() => {
            onMediaError("mp3");
          }}
          src={file.url}
        />
      </div>
    ),
    scrolls: "container",
  },
  code: { render: renderText, scrolls: "container" },
  csv: {
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.url}>
        <LazyCsvViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  docx: {
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.url}>
        <LazyDocxViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  html: {
    render: (context) =>
      context.viewMode === "raw" ? (
        renderText(context)
      ) : (
        <SandboxedHtmlIframe
          className="absolute inset-0 size-full border-0"
          key={context.htmlReloadNonce}
          src={context.file.url}
          title={context.file.filename}
        />
      ),
    scrolls: "container",
  },
  image: {
    render: ({ fallback, file, imageLoadError, onImageError }) =>
      imageLoadError ? (
        <div className="flex size-full items-center justify-center">
          {fallback}
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger className="size-full">
            <ImageViewer
              filename={file.filename}
              key={file.url}
              onError={onImageError}
              url={file.url}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <FileActionsMenuItems
              file={file}
              menuComponents={contextMenuComponents}
            />
          </ContextMenuContent>
        </ContextMenu>
      ),
    scrolls: "container",
  },
  markdown: {
    render: (context) =>
      context.viewMode === "raw" ? (
        renderText(context)
      ) : (
        <MarkdownPreview url={context.file.url} />
      ),
    scrolls: "container",
  },
  pdf: { render: renderPdf, scrolls: "self" },
  pptx: {
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.url}>
        <LazyPptxViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  text: { render: renderText, scrolls: "container" },
  unknown: {
    render: ({ fallback }) => (
      <div className="flex size-full items-center justify-center">
        {fallback}
      </div>
    ),
    scrolls: "container",
  },
  video: {
    // Muted is what makes autoplay allowed at all: Chrome blocks an unmuted
    // `autoPlay` outright, so the viewer would open on a frozen first frame.
    // Controls stay available to unmute and scrub.
    render: ({ file, onMediaError }) => (
      <ContextMenu>
        <ContextMenuTrigger className="size-full">
          <video
            autoPlay
            className="size-full object-contain"
            controls
            key={file.url}
            muted
            onError={() => {
              onMediaError("mp4");
            }}
            playsInline
            src={file.url}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <FileActionsMenuItems
            file={file}
            menuComponents={contextMenuComponents}
          />
        </ContextMenuContent>
      </ContextMenu>
    ),
    scrolls: "container",
  },
  xlsx: {
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.url}>
        <LazyXlsxViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
} satisfies Record<FileType, ViewerEntry>;

function renderPdf({ fallback, file }: ViewerContext) {
  return (
    <ViewerSurface fallback={fallback} resetKey={file.url}>
      <LazyPdfViewer filename={file.filename} url={file.url} />
    </ViewerSurface>
  );
}

function renderText({ file }: ViewerContext) {
  return (
    <TextView filename={file.filename} url={file.url}>
      {(text) => <pre className="p-4 text-sm text-foreground">{text}</pre>}
    </TextView>
  );
}

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

const fileViewerHeaderOpenWithTriggerClassName = toolbarClassName({
  className:
    "h-7 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
  pressed: false,
});

export function FileViewer({
  file,
  onClose,
  onExpand,
}: {
  file: TaskFileViewerFile;
  onClose: () => void;
  onExpand?: () => void;
}) {
  const { filename, filePath, mimeType, taskId, url } = file;
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  // Remounts the sandboxed HTML iframe back to its entry page. The iframe is a
  // cross-origin, opaque-origin sandbox, so we can't read or drive its history;
  // reloading `src` is the only way to escape an in-page link navigation.
  const [htmlReloadNonce, setHtmlReloadNonce] = useState(0);
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const [mediaErrorType, setMediaErrorType] = useState<string | undefined>();
  const [imageErrorUrl, setImageErrorUrl] = useState<null | string>(null);
  const imageLoadError = imageErrorUrl === url;
  const contentRef = useRef<HTMLDivElement>(null);
  const { active: copied, trigger: triggerCopied } = useTimedFlag();
  const openControl = useTaskFileOpenControl(file);
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
  const hasHeaderMenuActions =
    onExpand != null || fileActions.showDownload || fileActions.showReveal;
  const showOverflowMenu =
    fileActions.showDownload ||
    fileActions.showReveal ||
    hasPreview ||
    Boolean(onExpand);

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

  const viewer: ViewerEntry = VIEWERS[fileType];
  const viewerContext: ViewerContext = {
    fallback: (
      <FilePreviewFallback
        // Only consulted when the filename carries no recognizable extension,
        // where the type is all there is to go on: an image gets a picture
        // icon and everything else the generic binary one, rather than the
        // blank an absent stand-in leaves.
        fallbackExtension={fileType === "image" ? "jpg" : "bin"}
        file={file}
        filename={filename}
        onDownload={fileActions.showDownload ? handleDownload : undefined}
      />
    ),
    file,
    htmlReloadNonce,
    imageLoadError,
    onImageError: () => {
      setImageErrorUrl(url);
    },
    onMediaError: (fallbackExtension) => {
      setMediaLoadError(true);
      setMediaErrorType(fallbackExtension);
    },
    viewMode,
  };

  return (
    <div className={fileViewerClassName}>
      <div className="@container flex min-w-0 shrink-0 items-center gap-2 px-4 py-3">
        {/* The trigger is the filename, not the space it sits in: as a flex
            item it shrinks to the text it holds, so the tooltip is anchored
            under the name rather than under the middle of a header-wide box. */}
        <div className="flex min-w-0 flex-1">
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
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <OpenTaskFileButton
            className={fileViewerHeaderActionClassName}
            control={openControl}
            dropdownClassName={fileViewerHeaderOpenWithTriggerClassName}
            file={file}
            iconClassName="size-4"
            labelClassName="hidden max-w-40 min-w-0 truncate @min-[380px]:inline"
            size="sm"
            variant="ghost"
          />
          {fileType === "html" && viewMode === "preview" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className={fileViewerHeaderIconActionClassName}
                  onClick={() => {
                    setHtmlReloadNonce((nonce) => nonce + 1);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <ArrowClockwiseIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload</TooltipContent>
            </Tooltip>
          )}
          {fileActions.showCopy && !imageLoadError && (
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
                {fileActions.showDownload && (
                  <DropdownMenuItem onClick={() => void handleDownload()}>
                    <ArrowLineDownIcon className="size-4" />
                    <span>Save as…</span>
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

      {mediaLoadError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <FilePreviewFallback
            fallbackExtension={mediaErrorType}
            file={file}
            filename={filename}
            onDownload={fileActions.showDownload ? handleDownload : undefined}
          />
        </div>
      ) : viewer.scrolls === "self" ? (
        // Viewers that scroll internally own the whole content area, so they
        // are not nested inside the shared scroll container.
        <div className="flex min-h-0 flex-1 flex-col">
          {viewer.render(viewerContext)}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-auto" ref={contentRef}>
          {viewer.render(viewerContext)}
        </div>
      )}
    </div>
  );
}
