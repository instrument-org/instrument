import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { getLanguageFromFilePath } from "@/client/lib/file-extension-to-language";
import { getFileType } from "@/client/lib/get-file-type";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
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
import { tv } from "tailwind-variants";

import { useFileActionVisibility } from "../hooks/use-file-action-visibility";
import { useSyntaxHighlighting } from "../hooks/use-syntax-highlighting";
import { useTimedFlag } from "../hooks/use-timed-flag";
import { FilePreviewFallback } from "./file-preview-fallback";
import { FileVersionBadge } from "./file-version-badge";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
import { ImageWithFallback } from "./image-with-fallback";
import { SandboxedHtmlIframe } from "./sandboxed-html-iframe";
import { SessionMarkdown } from "./session-markdown";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
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
import { Spinner } from "./ui/spinner";
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
  base: "flex w-full flex-col overflow-hidden rounded-[1.25rem] bg-card shadow-panel",
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
  file: ProjectFileViewerFile;
  fullSize?: boolean;
  onClose: () => void;
  onExpand?: () => void;
}) {
  const { filename, filePath, mimeType, projectSubdomain, url, versionRef } =
    file;
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  const [isImageZoomed, setIsImageZoomed] = useState(false);
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const [mediaErrorType, setMediaErrorType] = useState<string | undefined>();
  const contentRef = useRef<HTMLDivElement>(null);
  const { active: copied, trigger: triggerCopied } = useTimedFlag();
  const revealFileMutation = useMutation(
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
        mimeType,
        subdomain: projectSubdomain,
        versionRef,
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
      subdomain: projectSubdomain,
    });
  };

  const handleImageClick = () => {
    setIsImageZoomed((zoomed) => !zoomed);
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
      <div className="flex shrink-0 items-center gap-2 px-5 py-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-xs font-medium">{filename}</span>
          </TooltipTrigger>
          <TooltipContent
            className="max-w-[min(500px,90vw)] wrap-break-word"
            collisionPadding={10}
          >
            {filePath}
          </TooltipContent>
        </Tooltip>
        {filePath && projectSubdomain && versionRef && (
          <FileVersionBadge
            filePath={filePath}
            projectSubdomain={projectSubdomain}
            versionRef={versionRef}
          />
        )}
        <div className="ml-auto flex items-center gap-1">
          {fileActions.showDownload && (
            <Button
              className={fileViewerHeaderActionClassName}
              onClick={() => void handleDownload()}
              size="sm"
              variant="ghost"
            >
              <ArrowLineDownIcon className="size-4" />
              <span>Download</span>
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
              <span>Copy</span>
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
          <div
            className={cn(
              "flex size-full items-center justify-center",
              isImageZoomed && "block",
            )}
          >
            <ImageWithFallback
              alt={filename}
              className={cn(
                "select-none",
                isImageZoomed
                  ? "size-auto max-w-none cursor-zoom-out"
                  : "size-auto max-h-full max-w-full cursor-zoom-in object-contain",
              )}
              fallback={
                <FilePreviewFallback
                  fallbackExtension="jpg"
                  filename={filename}
                  onDownload={
                    fileActions.showDownload ? handleDownload : undefined
                  }
                />
              }
              fallbackClassName="size-32 rounded-lg"
              filename={filename}
              onClick={handleImageClick}
              showCheckerboard
              src={url}
            />
          </div>
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
            src={url}
            title={filename}
          />
        ) : fileType === "video" ? (
          <video
            autoPlay
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
              autoPlay
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
