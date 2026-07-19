import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import {
  configureDocxWasmSource,
  configurePptxWasmSource,
  configureXlsxWasmSource,
} from "@/client/lib/document-wasm";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { getLanguageFromFilePath } from "@/client/lib/file-extension-to-language";
import { getFileType } from "@/client/lib/get-file-type";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  ArrowClockwiseIcon,
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
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { tv } from "tailwind-variants";

import { useFileActionVisibility } from "../hooks/use-file-action-visibility";
import {
  IMAGE_PANZOOM_VIEWPORT_CLASS,
  useImagePanzoom,
} from "../hooks/use-image-panzoom";
import { useSyntaxHighlighting } from "../hooks/use-syntax-highlighting";
import { useTaskFileOpenControl } from "../hooks/use-task-file-open-control";
import { useTimedFlag } from "../hooks/use-timed-flag";
import { FileActionsMenuItems } from "./file-actions-menu";
import { FilePreviewFallback } from "./file-preview-fallback";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
import { ImageWithFallback } from "./image-with-fallback";
import { OpenTaskFileButton } from "./open-task-file-button";
import { SandboxedHtmlIframe } from "./sandboxed-html-iframe";
import { SessionMarkdown } from "./session-markdown";
import { useTheme } from "./theme-provider";
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

// The document viewers pull in their own WebAssembly runtimes and are by far
// the heaviest components in the renderer, so they stay out of the entry chunk.
const PDFViewer = lazy(() =>
  import("./document-viewers/pdf-viewer").then((module) => ({
    default: module.PDFViewer,
  })),
);
const DocxViewerPreview = lazy(async () => {
  const [, module] = await Promise.all([
    configureDocxWasmSource(),
    import("./document-viewers/docx-viewer"),
  ]);
  return { default: module.DocxViewerPreview };
});
const PptxViewerPreview = lazy(async () => {
  const [, module] = await Promise.all([
    configurePptxWasmSource(),
    import("./document-viewers/pptx-viewer"),
  ]);
  return { default: module.PptxViewerPreview };
});
const XlsxViewerPreview = lazy(async () => {
  const [, module] = await Promise.all([
    configureXlsxWasmSource(),
    import("./document-viewers/xlsx-viewer"),
  ]);
  return { default: module.XlsxViewerPreview };
});

// The viewers fill their host and scroll internally, so they are pinned to the
// content area rather than laid out inside its scroll container.
function DocumentViewerSurface({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0">
      <Suspense
        fallback={
          <div className="flex size-full items-center justify-center">
            <Spinner className="size-8 text-muted-foreground" />
          </div>
        }
      >
        {children}
      </Suspense>
    </div>
  );
}

function DocxPreview({ filename, url }: { filename: string; url: string }) {
  const [isDark, setIsDark] = useViewerIsDark();

  return (
    <DocumentViewerSurface>
      <DocxViewerPreview
        className="h-full"
        fileName={filename}
        isDark={isDark}
        onIsDarkChange={setIsDark}
        showDownload={false}
        showUpload={false}
        src={url}
      />
    </DocumentViewerSurface>
  );
}

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

/**
 * The docx and xlsx viewers own a night-render toggle in their toolbar, so
 * their dark state has to be controlled. It is seeded from the app theme and
 * re-seeded whenever the app theme changes; between those, the viewer's own
 * toggle wins so the control is not inert.
 */
function useViewerIsDark() {
  const { resolvedTheme } = useTheme();
  const appIsDark = resolvedTheme === "dark";
  const [isDark, setIsDark] = useState(appIsDark);
  const [lastAppIsDark, setLastAppIsDark] = useState(appIsDark);

  if (appIsDark !== lastAppIsDark) {
    setLastAppIsDark(appIsDark);
    setIsDark(appIsDark);
  }

  return [isDark, setIsDark] as const;
}

function XlsxPreview({ filename, url }: { filename: string; url: string }) {
  const [isDark, setIsDark] = useViewerIsDark();

  return (
    <DocumentViewerSurface>
      <XlsxViewerPreview
        className="h-full"
        fileName={filename}
        isDark={isDark}
        onIsDarkChange={setIsDark}
        showDownload={false}
        showUpload={false}
        src={url}
      />
    </DocumentViewerSurface>
  );
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
      // Pages want height; slides and sheets want width.
      document: "h-[85vh] max-w-5xl",
      html: "h-[80vh] max-w-6xl",
      presentation: "h-[85vh] max-w-6xl",
      spreadsheet: "h-[85vh] max-w-[100rem]",
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

const fileViewerHeaderOpenWithTriggerClassName = toolbarClassName({
  className:
    "h-7 w-5 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
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
    if (fileType === "docx" || fileType === "pdf") {
      return "document";
    }
    if (fileType === "pptx") {
      return "presentation";
    }
    if (fileType === "xlsx") {
      return "spreadsheet";
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
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
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
                    <span>Download</span>
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
              file={file}
              filename={filename}
              onDownload={fileActions.showDownload ? handleDownload : undefined}
            />
          </div>
        ) : fileType === "markdown" && viewMode === "preview" ? (
          <MarkdownPreview url={url} />
        ) : fileType === "html" && viewMode === "preview" ? (
          <SandboxedHtmlIframe
            className="absolute inset-0 size-full border-0"
            key={htmlReloadNonce}
            src={url}
            title={filename}
          />
        ) : fileType === "image" ? (
          imageLoadError ? (
            <div className="flex size-full items-center justify-center">
              <FilePreviewFallback
                fallbackExtension="jpg"
                file={file}
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
          <DocumentViewerSurface>
            <PDFViewer
              className="h-full"
              fileName={filename}
              key={url}
              showDownload={false}
              showUpload={false}
              src={url}
            />
          </DocumentViewerSurface>
        ) : fileType === "docx" ? (
          <DocxPreview filename={filename} key={url} url={url} />
        ) : fileType === "pptx" ? (
          <DocumentViewerSurface>
            <PptxViewerPreview
              className="h-full"
              fileName={filename}
              key={url}
              showDownload={false}
              showUpload={false}
              src={url}
            />
          </DocumentViewerSurface>
        ) : fileType === "xlsx" ? (
          <XlsxPreview filename={filename} key={url} url={url} />
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
              file={file}
              filename={filename}
              onDownload={fileActions.showDownload ? handleDownload : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
