import { fileViewerWrapLinesAtom } from "@/client/atoms/file-viewer-wrap-lines";
import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import {
  LazyArchiveViewer,
  LazyCsvViewer,
  LazyDocxViewer,
  LazyIWorkViewer,
  LazyJsonlViewer,
  LazyParquetViewer,
  LazyPdfViewer,
  LazyPptxViewer,
  LazySqliteViewer,
  LazyXlsxViewer,
} from "@/client/lib/document-viewers";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { getLanguageFromFilePath } from "@/client/lib/file-extension-to-language";
import { type FileType, getFileType } from "@/client/lib/get-file-type";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowElbowDownLeftIcon } from "@phosphor-icons/react/ArrowElbowDownLeft";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { XIcon } from "@phosphor-icons/react/X";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useFileActionVisibility } from "../hooks/use-file-action-visibility";
import { useFileDrag } from "../hooks/use-file-drag";
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
  DropdownMenuCheckboxItem,
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

/**
 * Wrapping is entirely ours to decide: the highlighter hands back tokens as
 * inline spans inside one `<pre>`, so it reflows like any other markup and
 * nothing about the wrapped view is lost or approximated. Breaking is
 * `break-word` rather than `break-all` so a line only breaks mid-token when
 * the token could not fit a line of its own -- a minified bundle or a base64
 * blob wraps, an ordinary identifier stays whole.
 */
const wrapLinesClassName = "whitespace-pre-wrap wrap-break-word";

function CodeView({
  filename,
  url,
  wrapLines,
}: {
  filename: string;
  url: string;
  wrapLines: boolean;
}) {
  const { data, error, isLoading } = useFileText(url);

  const language = getLanguageFromFilePath(filename);
  const { highlightedHtml, isHighlightable } = useSyntaxHighlighting({
    code: data,
    language,
  });

  if (isLoading) {
    return <FileLoading />;
  }

  if (error) {
    return <FileTextError error={error} />;
  }

  if (highlightedHtml) {
    return (
      <div
        className={cn(
          "p-4 text-sm",
          wrapLines && "[&_pre]:wrap-break-word [&_pre]:whitespace-pre-wrap",
        )}
        dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
      />
    );
  }

  const plain = (
    <pre
      className={cn(
        "p-4 text-sm text-foreground",
        wrapLines && wrapLinesClassName,
      )}
    >
      {data}
    </pre>
  );

  if (isHighlightable) {
    // Delay showing plain text fallback to give syntax highlighting time to load
    return (
      <motion.div
        animate={{ opacity: 1 }}
        initial={{ opacity: 0 }}
        transition={{ delay: 0.3, duration: 0 }}
      >
        {plain}
      </motion.div>
    );
  }

  return plain;
}

function FileTextError({ error }: { error: unknown }) {
  return (
    <div className="flex size-full items-center justify-center p-8">
      <Alert className="max-w-2xl" variant="destructive">
        <AlertTitle>Failed to load file</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "An unknown error occurred"}
        </AlertDescription>
      </Alert>
    </div>
  );
}

function MarkdownPreview({ url }: { url: string }) {
  const { data, error, isLoading } = useFileText(url);

  if (isLoading) {
    return <FileLoading />;
  }

  if (error) {
    return <FileTextError error={error} />;
  }

  return <SessionMarkdown className="p-8" markdown={data ?? ""} />;
}

/**
 * A `.txt` is as likely to be a letter as a log, so it is read rather than
 * inspected: the reading typeface and the markdown preview's measure, wrapped
 * at the viewer's width instead of running off the right edge on one line.
 *
 * `pre-wrap` is what keeps that honest. The file's own line breaks, blank lines
 * and indentation are content -- a hard-wrapped paragraph, an indented list, a
 * signature block -- and reflowing them, as a markdown pass would, changes the
 * document rather than presenting it. Wrapping only happens where a line is too
 * long for the width on offer.
 */
function PlainTextView({
  url,
  wrapLines,
}: {
  url: string;
  wrapLines: boolean;
}) {
  const { data, error, isLoading } = useFileText(url);

  if (isLoading) {
    return <FileLoading />;
  }

  if (error) {
    return <FileTextError error={error} />;
  }

  return (
    <div
      className={cn(
        "p-8 text-sm/relaxed text-foreground",
        wrapLines ? wrapLinesClassName : "whitespace-pre",
      )}
    >
      {data}
    </div>
  );
}

function useFileText(url: string) {
  return useQuery({
    // The URL carries the file's mtime, so a save is a new key and a new
    // fetch. Holding the last text through it is what keeps the pane from
    // blanking to a loading state on every save of a file someone is editing
    // outside the app: the old bytes stay up, and the new ones replace them
    // when they arrive.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return response.text();
    },
    queryKey: ["file-text", url],
    retry: false, // Ensures fast failure
  });
}

// Both hosts (the artifact panel and the expand modal) give the viewer the
// space they have, so there is no intrinsic-size variant left to pick. Exported
// for the panel's placeholder frame, which stands in while a file is being
// looked up and has to be the same card.
export const fileViewerClassName =
  "flex h-full w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm";

interface ViewerContext {
  fallback: ReactNode;
  file: TaskFileViewerFile;
  htmlReloadNonce: number;
  imageLoadError: boolean;
  onImageError: () => void;
  onMediaError: (fallbackExtension: string) => void;
  viewMode: "preview" | "raw";
  wrapLines: boolean;
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
  /**
   * Whether this format's viewer opens a `ViewerToolbar` beneath the title
   * row. Declared here rather than read off the rendered tree, because
   * the answer decides which row closes the chrome band and the title row has
   * to know on its first frame -- a viewer mounts its toolbar only once the
   * document has parsed, so anything that observes the tree draws the hairline
   * under the title row and then moves it a row down when the file lands.
   */
  hasToolbar: boolean;
  render: (context: ViewerContext) => ReactNode;
  scrolls: "container" | "self";
}

const VIEWERS = {
  archive: {
    hasToolbar: true,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazyArchiveViewer url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  audio: {
    hasToolbar: false,
    render: ({ file, onMediaError }) => (
      <div className="flex size-full items-center justify-center p-8">
        <audio
          className="w-full max-w-2xl"
          controls
          key={file.filePath}
          onError={() => {
            onMediaError("mp3");
          }}
          src={file.url}
        />
      </div>
    ),
    scrolls: "container",
  },
  code: { hasToolbar: false, render: renderCode, scrolls: "container" },
  csv: {
    hasToolbar: true,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazyCsvViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  docx: {
    hasToolbar: true,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazyDocxViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  html: {
    hasToolbar: false,
    render: (context) =>
      context.viewMode === "raw" ? (
        renderCode(context)
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
    hasToolbar: false,
    render: ({ fallback, file, imageLoadError, onImageError }) =>
      imageLoadError ? (
        <div className="flex size-full items-center justify-center">
          {fallback}
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger className="size-full">
            <ImageViewer
              file={file}
              key={file.filePath}
              onError={onImageError}
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
  iwork: {
    hasToolbar: false,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazyIWorkViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  jsonl: {
    hasToolbar: true,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazyJsonlViewer url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  markdown: {
    hasToolbar: false,
    render: (context) =>
      context.viewMode === "raw" ? (
        renderCode(context)
      ) : (
        <MarkdownPreview url={context.file.url} />
      ),
    scrolls: "container",
  },
  parquet: {
    hasToolbar: true,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazyParquetViewer url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  pdf: { hasToolbar: true, render: renderPdf, scrolls: "self" },
  pptx: {
    hasToolbar: true,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazyPptxViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  sqlite: {
    hasToolbar: true,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazySqliteViewer url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
  text: {
    hasToolbar: false,
    render: ({ file, wrapLines }) => (
      <PlainTextView url={file.url} wrapLines={wrapLines} />
    ),
    scrolls: "container",
  },
  unknown: {
    hasToolbar: false,
    render: ({ fallback }) => (
      <div className="flex size-full items-center justify-center">
        {fallback}
      </div>
    ),
    scrolls: "container",
  },
  video: {
    hasToolbar: false,
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
            key={file.filePath}
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
    hasToolbar: true,
    render: ({ fallback, file }) => (
      <ViewerSurface fallback={fallback} resetKey={file.filePath}>
        <LazyXlsxViewer filename={file.filename} url={file.url} />
      </ViewerSurface>
    ),
    scrolls: "self",
  },
} satisfies Record<FileType, ViewerEntry>;

function renderCode({ file, wrapLines }: ViewerContext) {
  return (
    <CodeView filename={file.filename} url={file.url} wrapLines={wrapLines} />
  );
}

function renderPdf({ fallback, file }: ViewerContext) {
  return (
    <ViewerSurface fallback={fallback} resetKey={file.filePath}>
      <LazyPdfViewer filename={file.filename} url={file.url} />
    </ViewerSurface>
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

// Both segments of the open button are transparent until hovered, so hovering
// the label alone leaves the caret invisible and the control reads as having no
// menu. Tint the caret at a fraction of the hover fill instead: enough to show
// the two are one control, light enough to stay subordinate to the half the
// pointer is actually on. Alpha over the same token covers both themes, since
// dark's `muted` is already white at low opacity. Only while the menu is closed
// -- an open menu's fill says more than the neighbor's hover does.
const fileViewerHeaderOpenWithTriggerClassName = toolbarClassName({
  className:
    "h-7 peer-hover/open-file:data-[state=closed]:bg-muted/60 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
  pressed: false,
});

export function FileViewer({
  className,
  file,
  onClose,
  onExpand,
}: {
  // Set by a caller that already draws the surface this sits in, so the viewer
  // can drop its own card and fill the frame instead of nesting inside it.
  className?: string;
  file: TaskFileViewerFile;
  onClose?: () => void;
  onExpand?: () => void;
}) {
  const { filename, filePath, mimeType, taskId, url } = file;
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  const [wrapLines, setWrapLines] = useAtom(fileViewerWrapLinesAtom);
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
  // What is on screen is the file's own text, so the wrap preference governs
  // it: the code and plain text viewers always, a markdown or HTML file only
  // while its own view mode is showing the source.
  const showsFileText =
    fileType === "code" ||
    fileType === "text" ||
    (hasPreview && viewMode === "raw");
  const fileActions = useFileActionVisibility(file);
  const hasHeaderMenuActions =
    onExpand != null || fileActions.showDownload || fileActions.showReveal;
  const showOverflowMenu =
    fileActions.showDownload ||
    fileActions.showReveal ||
    hasPreview ||
    showsFileText ||
    Boolean(onExpand);

  const handleDownload = async () => {
    await downloadFile(file);
  };

  const handleCopy = async () => {
    try {
      await copyFileToClipboard({
        filePath,
        id: taskId,
        isImage: fileType === "image",
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
    wrapLines,
  };

  return (
    <div className={cn(fileViewerClassName, className)}>
      <FileViewerHeader
        actions={
          <>
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
                    aria-label="Reload"
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
                  {hasHeaderMenuActions && (hasPreview || showsFileText) && (
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
                  {showsFileText && (
                    <DropdownMenuCheckboxItem
                      checked={wrapLines}
                      onCheckedChange={setWrapLines}
                      // The menu would otherwise close on the first toggle, and
                      // seeing the file rewrap is the whole point of the item.
                      onSelect={(event) => {
                        event.preventDefault();
                      }}
                    >
                      <ArrowElbowDownLeftIcon className="size-4" />
                      <span>Wrap lines</span>
                    </DropdownMenuCheckboxItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
        filename={filename}
        filePath={filePath}
        mimeType={mimeType}
        onClose={onClose}
        taskId={taskId}
      />

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

/**
 * The file viewer's title row: the name on the left, the file's actions and the
 * close button on the right.
 *
 * Shared with the artifact panel's placeholder frame, which wears it while a
 * file is still being looked up. That is not a nicety: the two are on screen
 * back to back every time a file is opened, so any difference between them
 * reads as the name jumping the moment the viewer takes over.
 *
 * Where the format's viewer opens a toolbar, that row closes the band of chrome
 * and this one carries no stroke. The registry is asked rather than the tree,
 * so the answer holds from the first frame -- including in the placeholder,
 * which knows the path and nothing else yet.
 */
export function FileViewerHeader({
  actions,
  filename,
  filePath,
  mimeType,
  onClose,
  taskId,
}: {
  actions?: ReactNode;
  filename: string;
  filePath: string;
  mimeType?: string;
  // Absent in the pane, where the tab strip owns closing. Present in the
  // expanded modal, whose close is a collapse back to the pane.
  onClose?: () => void;
  // Absent while the panel is still resolving what it is about to show, where
  // there is no file to hand anyone yet.
  taskId?: TaskId;
}) {
  // The filename, not the viewer below it, is what drags the file out. Every
  // viewer's surface already answers to a gesture -- an image pans, a PDF and a
  // table select, an HTML preview is a sandboxed iframe whose events never
  // reach us -- and the one row that is chrome in all of them is this one.
  const dragProps = useFileDrag(taskId ? { filePath, taskId } : undefined);

  return (
    // `h-10 px-2` matches `ViewerToolbar`, which some viewers render right
    // below this, so the two rows read as one band.
    <div
      className={cn(
        "@container flex h-10 min-w-0 shrink-0 items-center gap-2 px-2",
        !VIEWERS[getFileType({ filename, mimeType })].hasToolbar &&
          "viewer-chrome-stroke",
      )}
    >
      {/* The trigger is the filename, not the space it sits in: as a flex
          item it shrinks to the text it holds, so the tooltip is anchored
          under the name rather than under the middle of a header-wide box. */}
      <div className="flex min-w-0 flex-1 pl-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "min-w-0 truncate text-xs font-medium",
                dragProps.draggable && "cursor-grab active:cursor-grabbing",
              )}
              {...dragProps}
            >
              {filename}
            </span>
          </TooltipTrigger>
          <TooltipContent
            className="wrap-break-word"
            collisionPadding={10}
            maxWidth="500px"
          >
            {filePath}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {onClose && (
          <Button
            className={fileViewerHeaderIconActionClassName}
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
