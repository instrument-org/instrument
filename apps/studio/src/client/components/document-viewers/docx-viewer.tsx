// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: import paths only.

import {
  DocumentViewerThumbnailSidebar,
  useElementWidth,
  useInlineThumbnailSidebar,
} from "@/client/components/document-viewers/document-viewer-sidebar";
import {
  createDocxCommentCardRenderer,
  createDocxTrackedChangeCardRenderer,
} from "@/client/components/document-viewers/docx-annotation-card";
import { FileThumbnail } from "@/client/components/document-viewers/file-thumbnail";
import { Button } from "@/client/components/ui/extend/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/extend/dropdown-menu";
import { Input } from "@/client/components/ui/extend/input";
import { ScrollArea } from "@/client/components/ui/extend/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/extend/select";
import { Separator } from "@/client/components/ui/extend/separator";
import { Spinner } from "@/client/components/ui/extend/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/client/components/ui/extend/tooltip";
import { cn } from "@/client/lib/utils";
import {
  type DocxDocumentTheme,
  type DocxEditorController,
  DocxEditorViewer,
  type DocxPageThumbnailItem,
  useDocxComments,
  useDocxEditor,
  useDocxPageLayout,
  useDocxTrackChanges,
  useDocxViewerThumbnails,
} from "@extend-ai/react-docx";
import {
  Comment01Icon,
  Download01Icon,
  FileDiffIcon,
  MinusSignCircleIcon,
  Moon02Icon,
  MoreHorizontalIcon,
  PlusSignCircleIcon,
  SidebarLeftIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as React from "react";

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_LOADING_INDICATOR_DELAY_MS = 300;
const DOCX_THUMBNAIL_WIDTH = 92;
const DOCX_THUMBNAIL_LIST_PADDING = 16;
const DOCX_THUMBNAIL_ROW_ESTIMATE = 172;
const DEFAULT_ZOOM = 50;
const ZOOM_OPTIONS = [10, 25, 50, 75, 100, 125, 150, 175, 200, 400] as const;
const MIN_ZOOM = Math.min(...ZOOM_OPTIONS);
const MAX_ZOOM = Math.max(...ZOOM_OPTIONS);
const DOCX_PADDING_WARNING_TEXT = "a style property during rerender";
const DOCX_THUMBNAIL_FOCUS_RING_CLASS =
  "group-focus-visible/docx-thumbnail-sidebar:ring-2 group-focus-visible/docx-thumbnail-sidebar:ring-ring group-focus-visible/docx-thumbnail-sidebar:ring-offset-1 group-focus-visible/docx-thumbnail-sidebar:ring-offset-background";
const DOCX_THUMBNAIL_PREFETCH_ROWS = 4;

type DocxActivePageStore = {
  getSnapshot: () => number;
  setActivePage: React.Dispatch<React.SetStateAction<number>>;
  subscribe: (listener: () => void) => () => void;
};

type DocxThumbnailRenderWindowState = {
  prefetchPageIndexes: number[];
  visiblePageIndexes: number[];
};

type UploadedDocxFile = {
  file: File;
  identity: string;
  sourceUrl: string | undefined;
};

export function DocxViewerPreview({
  className,
  defaultZoom = DEFAULT_ZOOM,
  fileName,
  isDark,
  onIsDarkChange,
  showDownload = true,
  showToolbar = true,
  showUpload = true,
  src,
  toolbarActions,
}: {
  className?: string;
  defaultZoom?: number;
  fileName?: string;
  isDark: boolean;
  onIsDarkChange: (isDark: boolean) => void;
  showDownload?: boolean;
  showToolbar?: boolean;
  showUpload?: boolean;
  src?: string;
  toolbarActions?: React.ReactNode;
}) {
  return (
    <DocxViewerContent
      className={className}
      defaultZoom={defaultZoom}
      effectiveIsDark={isDark}
      fileName={fileName}
      setNightRenderEnabled={onIsDarkChange}
      shouldRenderNightMode
      showDownload={showDownload}
      showToolbar={showToolbar}
      showUpload={showUpload}
      toolbarActions={toolbarActions}
      url={src}
    />
  );
}

function areNumberArraysEqual(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function createDocxActivePageStore(): DocxActivePageStore {
  let activePage = 1;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => activePage,
    setActivePage: (nextPage) => {
      const value =
        typeof nextPage === "function" ? nextPage(activePage) : nextPage;
      const normalizedValue = Math.max(1, Math.round(value || 1));

      if (normalizedValue === activePage) return;

      activePage = normalizedValue;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function DocxFileActionsMenu({
  controlsDisabled,
  downloadDisabled,
  isDark,
  isPreparingDownload,
  onDownload,
  onIsDarkChange,
  onShowCommentsChange,
  onShowTrackedChangesChange,
  onUploadClick,
  showComments,
  showDownloadButton,
  showNightRenderToggle,
  showTrackedChanges,
  showUploadButton,
}: {
  controlsDisabled: boolean;
  downloadDisabled: boolean;
  isDark: boolean;
  isPreparingDownload: boolean;
  onDownload: () => void;
  onIsDarkChange: (checked: boolean) => void;
  onShowCommentsChange: (checked: boolean) => void;
  onShowTrackedChangesChange: (checked: boolean) => void;
  onUploadClick: () => void;
  showComments: boolean;
  showDownloadButton: boolean;
  showNightRenderToggle: boolean;
  showTrackedChanges: boolean;
  showUploadButton: boolean;
}) {
  const showFileActions = showDownloadButton || showUploadButton;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Open DOCX actions"
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon className="size-4" icon={MoreHorizontalIcon} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {showNightRenderToggle ? (
          <>
            <DropdownMenuCheckboxItem
              checked={isDark}
              disabled={controlsDisabled}
              onCheckedChange={(checked) => onIsDarkChange(checked === true)}
              variant="switch"
            >
              <span className="flex min-w-0 items-center gap-2">
                <HugeiconsIcon className="size-4" icon={Moon02Icon} />
                Dark mode
              </span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuCheckboxItem
          checked={showComments}
          disabled={controlsDisabled}
          onCheckedChange={(checked) => onShowCommentsChange(checked === true)}
          variant="switch"
        >
          <span className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon className="size-4" icon={Comment01Icon} />
            Comments
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showTrackedChanges}
          disabled={controlsDisabled}
          onCheckedChange={(checked) =>
            onShowTrackedChangesChange(checked === true)
          }
          variant="switch"
        >
          <span className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon className="size-4" icon={FileDiffIcon} />
            Edits
          </span>
        </DropdownMenuCheckboxItem>
        {showFileActions ? <DropdownMenuSeparator /> : null}
        {showDownloadButton ? (
          <DropdownMenuItem disabled={downloadDisabled} onClick={onDownload}>
            {isPreparingDownload ? (
              <Spinner className="size-4" />
            ) : (
              <HugeiconsIcon className="size-4" icon={Download01Icon} />
            )}
            Download
          </DropdownMenuItem>
        ) : null}
        {showUploadButton ? (
          <DropdownMenuItem onClick={onUploadClick}>
            <HugeiconsIcon className="size-4" icon={Upload01Icon} />
            Upload
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocxPageNumberControl({
  activePageStore,
  controlsDisabled,
  onPageChange,
  pageCount,
}: {
  activePageStore: DocxActivePageStore;
  controlsDisabled: boolean;
  onPageChange: (pageNumber: number) => void;
  pageCount: number;
}) {
  const activePage = useDocxActivePage(activePageStore);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const displayPage = pageCount ? activePage : 1;
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftPage, setDraftPage] = React.useState(() => String(displayPage));

  React.useEffect(() => {
    if (!isEditing) {
      setDraftPage(String(displayPage));
    }
  }, [displayPage, isEditing]);

  React.useEffect(() => {
    if (!isEditing) return;

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const applyPageDraft = React.useCallback(
    (value: string) => {
      const trimmedValue = value.trim();

      if (!trimmedValue) return;

      const parsedPage = Number(trimmedValue);

      if (!Number.isInteger(parsedPage)) return;

      onPageChange(Math.min(Math.max(parsedPage, 1), Math.max(pageCount, 1)));
    },
    [onPageChange, pageCount],
  );

  return (
    <div className="flex items-center text-sm whitespace-nowrap text-primary">
      <span>Page</span>
      {isEditing ? (
        <Input
          aria-label="Page number"
          className="mx-1 w-14 min-w-14 rounded-md [&_[data-slot=input]]:text-center"
          inputMode="numeric"
          onBlur={() => setIsEditing(false)}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            const nextValue = event.target.value;

            setDraftPage(nextValue);
            applyPageDraft(nextValue);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
          pattern="[0-9]*"
          ref={inputRef}
          size="sm"
          value={draftPage}
        />
      ) : (
        <Button
          aria-label={`Current page ${displayPage}. Edit page number`}
          className="font-normal"
          disabled={controlsDisabled || !pageCount}
          onClick={() => {
            setDraftPage(String(displayPage));
            setIsEditing(true);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {displayPage}
        </Button>
      )}
      <span>of {pageCount || "-"}</span>
    </div>
  );
}

function DocxSidebarThumbnail({
  canvasRef,
  displayFileName,
  hasError,
  isActive,
  isLoading,
  pageNumber,
  pixelHeightPx,
  pixelWidthPx,
  previewAspectRatio,
}: {
  canvasRef: React.RefCallback<HTMLCanvasElement>;
  displayFileName: string;
  hasError: boolean;
  isActive: boolean;
  isLoading: boolean;
  pageNumber: number;
  pixelHeightPx: number;
  pixelWidthPx: number;
  previewAspectRatio: number;
}) {
  return (
    <FileThumbnail
      className={cn(
        "w-[92px] rounded-md border-0 shadow-xs ring-0 transition-shadow duration-150",
        isActive && "shadow-sm",
      )}
      file={{
        name: `${displayFileName} page ${pageNumber}`,
        type: DOCX_MIME_TYPE,
      }}
      hasError={hasError}
      isLoading={isLoading}
      previewAspectRatio={previewAspectRatio}
      previewClassName="rounded-md bg-white"
      previewContent={
        <canvas
          className="!size-full bg-white object-cover object-top"
          height={pixelHeightPx}
          ref={canvasRef}
          width={pixelWidthPx}
        />
      }
    />
  );
}

function DocxThumbnailSidebarContent({
  activePageStore,
  displayFileName,
  editor,
  isLoadingDocument,
  onSelectPage,
  pageCount,
  reportedPageCount,
  sidebarOpen,
}: {
  activePageStore: DocxActivePageStore;
  displayFileName: string;
  editor: DocxEditorController;
  isLoadingDocument: boolean;
  onSelectPage: (pageNumber: number) => void;
  pageCount: number;
  reportedPageCount: number;
  sidebarOpen: boolean;
}) {
  const [thumbnailRenderWindow, setThumbnailRenderWindow] =
    React.useState<DocxThumbnailRenderWindowState>({
      prefetchPageIndexes: [],
      visiblePageIndexes: [],
    });
  const thumbnailEditor = React.useMemo<DocxEditorController>(
    () => ({
      ...editor,
      totalPages: Math.max(editor.totalPages, reportedPageCount),
    }),
    [editor, reportedPageCount],
  );
  const thumbnailOptions = React.useMemo(
    () => ({
      // Detached thumbnail rendering handles offscreen pages; keep the raster
      // queue dormant while the sidebar is closed.
      disabled: !sidebarOpen,
      pixelRatio: 2,
      renderWindow: thumbnailRenderWindow,
      resolution: {
        maxHeight: DOCX_THUMBNAIL_WIDTH * 1.35,
        maxWidth: DOCX_THUMBNAIL_WIDTH,
      },
    }),
    [sidebarOpen, thumbnailRenderWindow],
  );
  const { thumbnails } = useDocxViewerThumbnails(
    thumbnailEditor,
    thumbnailOptions,
  );
  const activePage = useDocxActivePage(activePageStore);
  const handleThumbnailRenderWindowChange = React.useCallback(
    (nextRenderWindow: DocxThumbnailRenderWindowState) => {
      setThumbnailRenderWindow((currentRenderWindow) => {
        if (
          areNumberArraysEqual(
            currentRenderWindow.visiblePageIndexes,
            nextRenderWindow.visiblePageIndexes,
          ) &&
          areNumberArraysEqual(
            currentRenderWindow.prefetchPageIndexes,
            nextRenderWindow.prefetchPageIndexes,
          )
        ) {
          return currentRenderWindow;
        }

        return nextRenderWindow;
      });
    },
    [],
  );

  if (!sidebarOpen) return null;

  return (
    <DocxThumbnailSidebarList
      activePage={activePage}
      displayFileName={displayFileName}
      isLoadingDocument={isLoadingDocument}
      onSelectPage={onSelectPage}
      onThumbnailRenderWindowChange={handleThumbnailRenderWindowChange}
      pageCount={pageCount}
      sidebarOpen={sidebarOpen}
      thumbnails={thumbnails}
    />
  );
}

function DocxThumbnailSidebarList({
  activePage,
  displayFileName,
  isLoadingDocument,
  onSelectPage,
  onThumbnailRenderWindowChange,
  pageCount,
  sidebarOpen,
  thumbnails,
}: {
  activePage: number;
  displayFileName: string;
  isLoadingDocument: boolean;
  onSelectPage: (pageNumber: number) => void;
  onThumbnailRenderWindowChange: (
    renderWindow: DocxThumbnailRenderWindowState,
  ) => void;
  pageCount: number;
  sidebarOpen: boolean;
  thumbnails: DocxPageThumbnailItem[];
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const thumbnailListboxId = React.useId();
  const visibleThumbnails = React.useMemo(
    () => thumbnails.slice(0, pageCount || 0),
    [pageCount, thumbnails],
  );
  const activeDescendantId =
    activePage > 0 && visibleThumbnails.length > 0
      ? `${thumbnailListboxId}-page-${activePage}`
      : undefined;
  const virtualizer = useVirtualizer({
    count: visibleThumbnails.length,
    estimateSize: () => DOCX_THUMBNAIL_ROW_ESTIMATE,
    getItemKey: (index) => visibleThumbnails[index]?.pageIndex ?? index,
    getScrollElement: () => viewportRef.current,
    overscan: 3,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const renderWindowSignature = virtualItems
    .map((virtualRow) => virtualRow.index)
    .join(",");

  React.useEffect(() => {
    if (!sidebarOpen || isLoadingDocument || visibleThumbnails.length === 0) {
      onThumbnailRenderWindowChange({
        prefetchPageIndexes: [],
        visiblePageIndexes: [],
      });
      return;
    }

    const visiblePageIndexes = virtualItems
      .map((virtualRow) => visibleThumbnails[virtualRow.index]?.pageIndex)
      .filter((pageIndex): pageIndex is number => pageIndex !== undefined);

    const firstVirtualIndex = virtualItems[0]?.index ?? 0;
    const lastVirtualIndex = virtualItems.at(-1)?.index ?? firstVirtualIndex;
    const firstPrefetchIndex = Math.max(
      0,
      firstVirtualIndex - DOCX_THUMBNAIL_PREFETCH_ROWS,
    );
    const lastPrefetchIndex = Math.min(
      visibleThumbnails.length - 1,
      lastVirtualIndex + DOCX_THUMBNAIL_PREFETCH_ROWS,
    );
    const visiblePageIndexSet = new Set(visiblePageIndexes);
    const prefetchPageIndexes: number[] = [];

    for (
      let index = firstPrefetchIndex;
      index <= lastPrefetchIndex;
      index += 1
    ) {
      const pageIndex = visibleThumbnails[index]?.pageIndex;

      if (pageIndex !== undefined && !visiblePageIndexSet.has(pageIndex)) {
        prefetchPageIndexes.push(pageIndex);
      }
    }

    onThumbnailRenderWindowChange({
      prefetchPageIndexes,
      visiblePageIndexes,
    });
  }, [
    isLoadingDocument,
    onThumbnailRenderWindowChange,
    renderWindowSignature,
    sidebarOpen,
    visibleThumbnails,
    virtualItems,
  ]);

  React.useEffect(() => {
    if (!sidebarOpen || activePage < 1 || visibleThumbnails.length === 0)
      return;

    virtualizer.scrollToIndex(
      Math.min(activePage - 1, visibleThumbnails.length - 1),
      { align: "auto" },
    );
  }, [activePage, sidebarOpen, virtualizer, visibleThumbnails.length]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (pageCount < 1) return;

      const currentPage = activePage > 0 ? activePage : 1;
      let nextPage: null | number = null;

      switch (event.key) {
        case "ArrowDown": {
          nextPage = Math.min(pageCount, currentPage + 1);

          break;
        }
        case "ArrowUp": {
          nextPage = Math.max(1, currentPage - 1);

          break;
        }
        case "End": {
          nextPage = pageCount;

          break;
        }
        case "Home": {
          nextPage = 1;

          break;
        }
        // No default
      }

      if (nextPage === null) return;

      event.preventDefault();
      onSelectPage(nextPage);
    },
    [activePage, onSelectPage, pageCount],
  );

  return (
    <ScrollArea
      className="h-full"
      scrollFade
      viewportClassName="group/docx-thumbnail-sidebar focus-visible:ring-0 focus-visible:ring-offset-0"
      viewportProps={{
        "aria-activedescendant": activeDescendantId,
        "aria-busy": isLoadingDocument || undefined,
        "aria-label": "DOCX pages",
        onKeyDown: handleKeyDown,
        onMouseDown: (event) => {
          event.currentTarget.focus({ preventScroll: true });
        },
        role: "listbox",
        tabIndex: 0,
      }}
      viewportRef={viewportRef}
    >
      {isLoadingDocument ? (
        <div className="p-4">
          <div className="mx-auto h-28 w-20 overflow-hidden rounded-md bg-background shadow-xs">
            <div className="h-full animate-pulse bg-muted" />
          </div>
          <div className="mx-auto mt-3 h-3 w-10 rounded-full bg-muted" />
        </div>
      ) : visibleThumbnails.length > 0 ? (
        <div
          className="relative"
          style={{
            height:
              virtualizer.getTotalSize() + DOCX_THUMBNAIL_LIST_PADDING * 2,
          }}
        >
          {virtualItems.map((virtualRow) => {
            const thumbnail = visibleThumbnails[virtualRow.index];
            if (!thumbnail) return null;

            return (
              <div
                className={cn(
                  "absolute top-0 right-3 left-3 pb-3 [contain:layout]",
                  thumbnail.pageNumber === activePage && "z-10",
                )}
                data-index={virtualRow.index}
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                style={{
                  transform: `translateY(${
                    virtualRow.start + DOCX_THUMBNAIL_LIST_PADDING
                  }px)`,
                }}
              >
                <div
                  aria-current={
                    thumbnail.pageNumber === activePage ? "page" : undefined
                  }
                  aria-label={`Page ${thumbnail.pageNumber}`}
                  aria-posinset={thumbnail.pageNumber}
                  aria-selected={thumbnail.pageNumber === activePage}
                  aria-setsize={pageCount}
                  className={cn(
                    "flex h-auto w-full cursor-default flex-col items-center gap-2 rounded-md p-2 text-xs transition-shadow outline-none select-none hover:bg-sidebar-accent",
                    thumbnail.pageNumber === activePage &&
                      "bg-sidebar-accent text-foreground",
                    thumbnail.pageNumber !== activePage &&
                      "text-muted-foreground",
                    thumbnail.pageNumber === activePage &&
                      DOCX_THUMBNAIL_FOCUS_RING_CLASS,
                  )}
                  data-docx-viewer-thumbnail-option={thumbnail.pageNumber}
                  id={`${thumbnailListboxId}-page-${thumbnail.pageNumber}`}
                  onClick={() => onSelectPage(thumbnail.pageNumber)}
                  role="option"
                >
                  <DocxSidebarThumbnail
                    canvasRef={thumbnail.canvasRef}
                    displayFileName={displayFileName}
                    hasError={thumbnail.status === "error"}
                    isActive={thumbnail.pageNumber === activePage}
                    isLoading={
                      thumbnail.status !== "ready" &&
                      thumbnail.status !== "error"
                    }
                    pageNumber={thumbnail.pageNumber}
                    pixelHeightPx={thumbnail.pixelHeightPx}
                    pixelWidthPx={thumbnail.pixelWidthPx}
                    previewAspectRatio={thumbnail.aspectRatio}
                  />
                  {thumbnail.pageNumber}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </ScrollArea>
  );
}

function DocxToolbar({
  activePageStore,
  controlsDisabled,
  isDark,
  isPreparingDownload,
  onDownload,
  onIsDarkChange,
  onPageChange,
  onShowCommentsChange,
  onShowTrackedChangesChange,
  onToggleSidebar,
  onUploadClick,
  pageCount,
  setZoomScale,
  showComments,
  showDownloadButton = true,
  showNightRenderToggle,
  showTrackedChanges,
  showUploadButton = true,
  toolbarActions,
  zoomScale,
}: {
  activePageStore: DocxActivePageStore;
  controlsDisabled: boolean;
  isDark: boolean;
  isPreparingDownload: boolean;
  onDownload: () => void;
  onIsDarkChange: (checked: boolean) => void;
  onPageChange: (pageNumber: number) => void;
  onShowCommentsChange: (checked: boolean) => void;
  onShowTrackedChangesChange: (checked: boolean) => void;
  onToggleSidebar: () => void;
  onUploadClick: () => void;
  pageCount: number;
  setZoomScale: React.Dispatch<React.SetStateAction<number>>;
  showComments: boolean;
  showDownloadButton?: boolean;
  showNightRenderToggle: boolean;
  showTrackedChanges: boolean;
  showUploadButton?: boolean;
  toolbarActions?: React.ReactNode;
  zoomScale: number;
}) {
  const canZoomIn = zoomScale < MAX_ZOOM;
  const canZoomOut = zoomScale > MIN_ZOOM;

  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
      <TooltipProvider>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ToolbarTooltip label="Toggle thumbnails">
            <Button
              aria-label="Toggle thumbnails"
              disabled={controlsDisabled}
              onClick={onToggleSidebar}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon className="size-4" icon={SidebarLeftIcon} />
            </Button>
          </ToolbarTooltip>
          <DocxPageNumberControl
            activePageStore={activePageStore}
            controlsDisabled={controlsDisabled}
            onPageChange={onPageChange}
            pageCount={pageCount}
          />
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          <div className="flex flex-none items-center gap-1">
            <ToolbarTooltip label="Zoom out">
              <Button
                aria-label="Zoom out"
                disabled={controlsDisabled || !canZoomOut}
                onClick={() =>
                  setZoomScale((currentZoomScale) =>
                    getNextZoomScale(currentZoomScale, -1),
                  )
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon className="size-4" icon={MinusSignCircleIcon} />
              </Button>
            </ToolbarTooltip>
            <Select
              disabled={controlsDisabled}
              modal={false}
              onValueChange={(value) => setZoomScale(Number(value))}
              value={zoomScale.toString()}
            >
              <SelectTrigger
                aria-label="Zoom level"
                className="w-[84px] min-w-[84px]"
                size="sm"
              >
                <SelectValue>{Math.round(zoomScale)}%</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {ZOOM_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value.toString()}>
                    {value}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToolbarTooltip label="Zoom in">
              <Button
                aria-label="Zoom in"
                disabled={controlsDisabled || !canZoomIn}
                onClick={() =>
                  setZoomScale((currentZoomScale) =>
                    getNextZoomScale(currentZoomScale, 1),
                  )
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon className="size-4" icon={PlusSignCircleIcon} />
              </Button>
            </ToolbarTooltip>
          </div>
          {toolbarActions ? (
            <>
              <Separator
                className="mx-1 h-4 self-center"
                orientation="vertical"
              />
              {toolbarActions}
            </>
          ) : null}
          <Separator className="mx-1 h-4 self-center" orientation="vertical" />
          <DocxFileActionsMenu
            controlsDisabled={controlsDisabled}
            downloadDisabled={controlsDisabled || isPreparingDownload}
            isDark={isDark}
            isPreparingDownload={isPreparingDownload}
            onDownload={onDownload}
            onIsDarkChange={onIsDarkChange}
            onShowCommentsChange={onShowCommentsChange}
            onShowTrackedChangesChange={onShowTrackedChangesChange}
            onUploadClick={onUploadClick}
            showComments={showComments}
            showDownloadButton={showDownloadButton}
            showNightRenderToggle={showNightRenderToggle}
            showTrackedChanges={showTrackedChanges}
            showUploadButton={showUploadButton}
          />
        </div>
      </TooltipProvider>
    </div>
  );
}

function DocxViewerContent({
  className,
  defaultZoom,
  effectiveIsDark,
  fileName,
  setNightRenderEnabled,
  shouldRenderNightMode,
  showDownload,
  showToolbar = true,
  showUpload,
  toolbarActions,
  url,
}: {
  className?: string;
  defaultZoom?: number;
  effectiveIsDark: boolean;
  fileName?: string;
  setNightRenderEnabled: (checked: boolean) => void;
  shouldRenderNightMode: boolean;
  showDownload: boolean;
  showToolbar?: boolean;
  showUpload: boolean;
  toolbarActions?: React.ReactNode;
  url?: string;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportElement, setViewportElement] =
    React.useState<HTMLDivElement | null>(null);
  const [viewerShellRef, viewerShellWidth] = useElementWidth<HTMLDivElement>();
  const [uploadedDocxFile, setUploadedDocxFile] =
    React.useState<null | UploadedDocxFile>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const activePageStore = React.useMemo(createDocxActivePageStore, []);
  const resolvedDefaultZoomScale = normalizeDocxZoomScale(defaultZoom);
  const activeUploadedDocxFile =
    uploadedDocxFile?.sourceUrl === url ? uploadedDocxFile : null;
  const documentKey = activeUploadedDocxFile?.identity ?? url ?? "";
  const setActivePage = activePageStore.setActivePage;
  const sidebarInline = useInlineThumbnailSidebar(viewerShellWidth);
  const viewerBackgroundColor =
    "color-mix(in oklab, var(--muted) 40%, transparent)";
  const displayFileName = React.useMemo(
    () =>
      activeUploadedDocxFile?.file.name ??
      (url ? formatDocumentName(fileName, url) : (fileName ?? "document.docx")),
    [activeUploadedDocxFile?.file.name, fileName, url],
  );
  const [initialDocumentTheme] = React.useState<DocxDocumentTheme>(() =>
    effectiveIsDark ? "dark" : "light",
  );
  const editorOptions = React.useMemo(
    () => ({
      initialDocumentTheme,
      initialFileName: displayFileName,
    }),
    [displayFileName, initialDocumentTheme],
  );
  const editor = useDocxEditor(editorOptions);
  const { layout: pageLayout } = useDocxPageLayout(editor);
  const { importDocxFile, setDocumentTheme, status } = editor;
  const { setShowComments, showComments } = useDocxComments(editor);
  const { setShowTrackedChanges, showTrackedChanges } =
    useDocxTrackChanges(editor);
  const [reportedPageCount, setReportedPageCount] = React.useState(0);
  const [zoomScaleState, setZoomScaleState] = React.useState({
    documentKey: "",
    value: resolvedDefaultZoomScale,
  });
  const zoomScale =
    zoomScaleState.documentKey === documentKey
      ? zoomScaleState.value
      : resolvedDefaultZoomScale;
  const setZoomScale = React.useCallback<
    React.Dispatch<React.SetStateAction<number>>
  >(
    (nextZoomScale) => {
      setZoomScaleState((currentState) => {
        const currentZoomScale =
          currentState.documentKey === documentKey
            ? currentState.value
            : resolvedDefaultZoomScale;
        const value =
          typeof nextZoomScale === "function"
            ? nextZoomScale(currentZoomScale)
            : nextZoomScale;

        return { documentKey, value };
      });
    },
    [documentKey, resolvedDefaultZoomScale],
  );
  const [loadError, setLoadError] = React.useState<string>();
  const [isLoadingDocument, setIsLoadingDocument] = React.useState(true);
  const [isPreparingDownload, setIsPreparingDownload] = React.useState(false);
  const shouldShowDocumentSpinner = useDelayedLoadingIndicator(
    isLoadingDocument,
    DOCX_LOADING_INDICATOR_DELAY_MS,
  );
  const loadingState = (
    <ViewerLoadingSurface showSpinner={shouldShowDocumentSpinner} />
  );
  const documentTheme = effectiveIsDark ? "dark" : "light";
  const renderTrackedChangeCard = React.useMemo(
    () => createDocxTrackedChangeCardRenderer(documentTheme),
    [documentTheme],
  );
  const renderCommentCard = React.useMemo(
    () => createDocxCommentCardRenderer(documentTheme),
    [documentTheme],
  );
  const hasDocument = Boolean(url || activeUploadedDocxFile);
  const pageCount =
    hasDocument && !isLoadingDocument && !loadError
      ? Math.max(1, reportedPageCount || editor.totalPages)
      : 0;
  const thumbnailSidebarVisible = Boolean(
    sidebarOpen && (pageCount || isLoadingDocument),
  );
  const controlsDisabled =
    !hasDocument || isLoadingDocument || Boolean(loadError);
  const handlePageCountChange = React.useCallback((nextPageCount: number) => {
    setReportedPageCount(Math.max(1, Math.round(nextPageCount || 1)));
  }, []);
  const setViewportRef = React.useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element;
    setViewportElement(element);
  }, []);
  const pageVirtualization = React.useMemo(
    () => ({
      enabled: true,
      overscan: 1,
      scrollElement: viewportElement,
      zoomScale: zoomScale / 100,
    }),
    [viewportElement, zoomScale],
  );
  const handleDownload = React.useCallback(async () => {
    if (isPreparingDownload) return;
    if (!activeUploadedDocxFile && !url) return;

    setIsPreparingDownload(true);

    try {
      await downloadDocxFile({
        file: activeUploadedDocxFile?.file,
        fileName: displayFileName,
        url,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsPreparingDownload(false);
    }
  }, [activeUploadedDocxFile, displayFileName, isPreparingDownload, url]);
  useSuppressDocxPaddingWarning(!isLoadingDocument && !loadError);

  React.useEffect(() => {
    setActivePage(1);
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  }, [documentKey, setActivePage]);

  React.useEffect(() => {
    setDocumentTheme(effectiveIsDark ? "dark" : "light");
  }, [effectiveIsDark, setDocumentTheme]);

  React.useEffect(() => {
    if (
      !status.startsWith("Failed to load file") &&
      status !== "Only .docx files are supported"
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setLoadError(status);
      setIsLoadingDocument(false);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [status]);

  // Imports mutate the shared editor instance; concurrent calls (effect
  // re-runs, StrictMode double-invoke) race inside the parser and surface as
  // bogus "Invalid DOCX ZIP" errors, so every import is chained through here.
  const importQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    let isCurrent = true;

    async function load() {
      // Superseded while queued — let the newest import run instead.
      if (!isCurrent) return;
      if (!activeUploadedDocxFile && !url) {
        setIsLoadingDocument(false);
        setLoadError(undefined);
        setReportedPageCount(0);
        return;
      }

      setIsLoadingDocument(true);
      setLoadError(undefined);
      setReportedPageCount(0);

      try {
        const docxFile =
          activeUploadedDocxFile?.file ??
          (url ? await loadDocxFile(url, displayFileName) : null);
        if (!docxFile) return;
        await importDocxFile(docxFile);

        if (isCurrent) {
          setIsLoadingDocument(false);
          setActivePage(1);
          viewportRef.current?.scrollTo({ left: 0, top: 0 });
        }
      } catch (error) {
        if (isCurrent) {
          setLoadError(
            error instanceof Error ? error.message : "Unknown DOCX load error",
          );
          setIsLoadingDocument(false);
        }
      }
    }

    importQueueRef.current = importQueueRef.current.then(load);

    return () => {
      isCurrent = false;
    };
  }, [
    activeUploadedDocxFile,
    displayFileName,
    importDocxFile,
    setActivePage,
    url,
  ]);

  const updateActivePageFromViewport = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pageCount) return;

    const viewportRect = viewport.getBoundingClientRect();
    const viewportCenter = viewportRect.top + viewportRect.height / 2;
    let closestPage = 1;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const page of viewport.querySelectorAll<HTMLElement>(
      '[data-docx-page-wrapper="true"][data-index]',
    )) {
      const pageIndex = Number(page.dataset.index);
      if (!Number.isFinite(pageIndex)) continue;

      const pageRect = page.getBoundingClientRect();
      const pageCenter = pageRect.top + pageRect.height / 2;
      const distance = Math.abs(pageCenter - viewportCenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = pageIndex + 1;
      }
    }

    activePageStore.setActivePage((currentPage) =>
      currentPage === closestPage ? currentPage : closestPage,
    );
  }, [activePageStore, pageCount]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pageCount) return;

    let frameId = 0;
    const handleScroll = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateActivePageFromViewport);
    };

    frameId = window.requestAnimationFrame(updateActivePageFromViewport);
    viewport.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [pageCount, updateActivePageFromViewport]);

  const scrollToPage = React.useCallback(
    (pageNumber: number) => {
      const viewport = viewportRef.current;
      const targetPageIndex = pageNumber - 1;
      const page = viewport?.querySelector<HTMLElement>(
        `[data-docx-page-wrapper="true"][data-index="${targetPageIndex}"]`,
      );

      setActivePage(pageNumber);

      if (!viewport) return;

      if (!page) {
        const pageStridePx =
          (pageLayout.pageHeightPx + pageLayout.viewportDefaults.pageGapPx) *
          (zoomScale / 100);

        viewport.scrollTo({
          behavior: "auto",
          top: Math.max(0, targetPageIndex * pageStridePx - 24),
        });
        return;
      }

      viewport.scrollTo({
        behavior: "auto",
        top:
          page.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop -
          24,
      });
    },
    [
      pageLayout.pageHeightPx,
      pageLayout.viewportDefaults.pageGapPx,
      setActivePage,
      zoomScale,
    ],
  );

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setZoomScale(resolvedDefaultZoomScale);
    setActivePage(1);
    setReportedPageCount(0);
    setUploadedDocxFile({
      file,
      identity: `${file.name}-${file.size}-${file.lastModified}`,
      sourceUrl: url,
    });
  }

  return (
    <div
      className={cn(
        "flex h-[640px] min-h-0 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <input
        accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleUpload}
        ref={fileInputRef}
        type="file"
      />
      {showToolbar ? (
        <DocxToolbar
          activePageStore={activePageStore}
          controlsDisabled={controlsDisabled}
          isDark={effectiveIsDark}
          isPreparingDownload={isPreparingDownload}
          onDownload={handleDownload}
          onIsDarkChange={setNightRenderEnabled}
          onPageChange={scrollToPage}
          onShowCommentsChange={setShowComments}
          onShowTrackedChangesChange={setShowTrackedChanges}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onUploadClick={() => fileInputRef.current?.click()}
          pageCount={pageCount}
          setZoomScale={setZoomScale}
          showComments={showComments}
          showDownloadButton={showDownload}
          showNightRenderToggle={shouldRenderNightMode}
          showTrackedChanges={showTrackedChanges}
          showUploadButton={showUpload}
          toolbarActions={toolbarActions}
          zoomScale={zoomScale}
        />
      ) : null}
      <div
        className="relative flex min-h-0 flex-1 overflow-hidden bg-muted/30"
        ref={viewerShellRef}
      >
        <DocumentViewerThumbnailSidebar
          inline={sidebarInline}
          open={thumbnailSidebarVisible}
        >
          <DocxThumbnailSidebarContent
            activePageStore={activePageStore}
            displayFileName={displayFileName}
            editor={editor}
            isLoadingDocument={isLoadingDocument}
            onSelectPage={scrollToPage}
            pageCount={pageCount}
            reportedPageCount={reportedPageCount}
            sidebarOpen={thumbnailSidebarVisible}
          />
        </DocumentViewerThumbnailSidebar>
        <ScrollArea
          className="min-h-0 flex-1"
          style={{ backgroundColor: viewerBackgroundColor }}
          viewportClassName="px-4 py-6"
          viewportProps={{
            "aria-label": "DOCX document",
            onMouseDown: (event) => {
              if (isInteractiveViewerTarget(event.target)) return;
              event.currentTarget.focus({ preventScroll: true });
            },
            tabIndex: 0,
          }}
          viewportRef={setViewportRef}
        >
          {!url && !activeUploadedDocxFile ? (
            <div className="grid h-full min-h-96 place-items-center p-6 text-center">
              <div className="max-w-md rounded-lg border bg-background p-4 text-sm shadow-xs">
                <div className="font-medium">
                  Upload a Word document to preview
                </div>
                <div className="mt-1 text-muted-foreground">
                  Pass a DOCX URL with the <code>src</code> prop or upload a
                  file.
                </div>
                <div className="mt-1 text-muted-foreground">
                  Legacy <code>.doc</code> support is limited and experimental;
                  convert to DOCX for best fidelity.
                </div>
                <Button
                  className="mt-4"
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <HugeiconsIcon className="size-4" icon={Upload01Icon} />
                  Upload Word document
                </Button>
              </div>
            </div>
          ) : loadError ? (
            <div className="grid h-full min-h-96 place-items-center p-6 text-center">
              <div className="max-w-md rounded-lg border bg-background p-4 text-sm text-destructive shadow-xs">
                <div className="font-medium">Unable to display DOCX</div>
                <div className="mt-1 text-muted-foreground">{loadError}</div>
              </div>
            </div>
          ) : isLoadingDocument ? (
            loadingState
          ) : (
            <div className="flex min-h-full w-max min-w-full justify-center">
              <div
                className={cn(
                  "origin-top",
                  effectiveIsDark && "docx-night-reader-shell",
                )}
                style={{ zoom: zoomScale / 100 }}
              >
                <DocxEditorViewer
                  deferInitialPaginationPaint={false}
                  editor={editor}
                  loadingState={loadingState}
                  mode="read-only"
                  onPageCountChange={handlePageCountChange}
                  pageBackgroundColor={effectiveIsDark ? "#0a0a0a" : undefined}
                  pageGapBackgroundColor={viewerBackgroundColor}
                  pageVirtualization={pageVirtualization}
                  renderCommentCard={renderCommentCard}
                  renderTrackedChangeCard={renderTrackedChangeCard}
                  showComments={showComments}
                  showTrackedChanges={showTrackedChanges}
                />
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadDocxFile({
  file,
  fileName,
  url,
}: {
  file?: File;
  fileName: string;
  url?: string;
}) {
  if (file) {
    downloadBlob(file, ensureDocxExtension(fileName));
    return;
  }

  if (!url) return;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download DOCX (${response.status})`);
  }

  downloadBlob(await response.blob(), ensureDocxExtension(fileName));
}

function ensureDocxExtension(fileName: string) {
  return fileName.toLowerCase().endsWith(".docx")
    ? fileName
    : `${fileName}.docx`;
}

function formatDocumentName(fileName: string | undefined, url: string) {
  if (fileName?.trim()) return fileName;

  const pathname = url.split("?")[0] ?? "";
  const rawName = pathname.split("/").pop() ?? "document.docx";

  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function getNextZoomScale(currentZoomScale: number, direction: -1 | 1) {
  const currentIndex = ZOOM_OPTIONS.indexOf(
    currentZoomScale as (typeof ZOOM_OPTIONS)[number],
  );
  let fallbackIndex = -1;

  if (direction > 0) {
    fallbackIndex = ZOOM_OPTIONS.findIndex((value) => value > currentZoomScale);
  } else {
    for (let index = ZOOM_OPTIONS.length - 1; index >= 0; index -= 1) {
      const option = ZOOM_OPTIONS[index];

      if (option !== undefined && option < currentZoomScale) {
        fallbackIndex = index;
        break;
      }
    }
  }

  const resolvedIndex = currentIndex === -1 ? fallbackIndex : currentIndex;
  if (resolvedIndex < 0) return currentZoomScale;

  const nextIndex = Math.min(
    Math.max(resolvedIndex + direction, 0),
    ZOOM_OPTIONS.length - 1,
  );

  return ZOOM_OPTIONS[nextIndex] ?? currentZoomScale;
}

function isDocxPaddingWarning(args: unknown[]) {
  return (
    typeof args[0] === "string" &&
    args[0].includes(DOCX_PADDING_WARNING_TEXT) &&
    args.some((arg) => String(arg).includes("padding"))
  );
}

function isInteractiveViewerTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'a[href], button, input, select, textarea, [contenteditable="true"], [role="button"], [role="link"]',
      ),
    )
  );
}

async function loadDocxFile(
  url: string,
  displayFileName: string,
): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch DOCX (${response.status})`);
  }

  const blob = await response.blob();
  return new File([blob], displayFileName, {
    type: blob.type || DOCX_MIME_TYPE,
  });
}

function normalizeDocxZoomScale(value: number | undefined): number {
  return typeof value === "number" &&
    ZOOM_OPTIONS.includes(value as (typeof ZOOM_OPTIONS)[number])
    ? value
    : DEFAULT_ZOOM;
}

function ToolbarTooltip({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function useDelayedLoadingIndicator(isLoading: boolean, delayMs: number) {
  const [showSpinner, setShowSpinner] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading) return;

    const timeoutId = window.setTimeout(() => {
      setShowSpinner(true);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
      setShowSpinner(false);
    };
  }, [delayMs, isLoading]);

  return isLoading && showSpinner;
}

function useDocxActivePage(activePageStore: DocxActivePageStore) {
  return React.useSyncExternalStore(
    activePageStore.subscribe,
    activePageStore.getSnapshot,
    activePageStore.getSnapshot,
  );
}

function useSuppressDocxPaddingWarning(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;

    const originalConsoleError = console.error;

    console.error = (...args: unknown[]) => {
      if (isDocxPaddingWarning(args)) return;
      originalConsoleError(...args);
    };

    return () => {
      console.error = originalConsoleError;
    };
  }, [enabled]);
}

function ViewerLoadingSurface({
  showSpinner = true,
}: {
  showSpinner?: boolean;
}) {
  return (
    <div className="grid h-full min-h-52 place-items-center bg-transparent">
      {showSpinner ? <Spinner className="size-4" /> : null}
    </div>
  );
}
