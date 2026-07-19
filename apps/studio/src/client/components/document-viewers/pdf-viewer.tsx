// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: import paths, and the document-level copy shortcut is scoped
// to the viewer's own subtree so it cannot answer for a selection elsewhere in
// the host app. The pdfium engine comes from `pdf-thumbnail-utils`.

import type {
  PdfDocumentObject,
  PdfEngine,
  Rect,
  Rotation,
} from "@embedpdf/models";

import {
  DocumentViewerSidebarSkeleton,
  DocumentViewerThumbnailSidebar,
  useElementWidth,
  useInlineThumbnailSidebar,
} from "@/client/components/document-viewers/document-viewer-sidebar";
import { loadSharedPdfEngine } from "@/client/components/document-viewers/pdf-thumbnail-utils";
import { Button } from "@/client/components/ui/extend/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/extend/dropdown-menu";
import { Input } from "@/client/components/ui/extend/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/extend/popover";
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
import { createPluginRegistration, refreshPages } from "@embedpdf/core";
import { EmbedPDF, useRegistry } from "@embedpdf/core/react";
import {
  DocumentManagerPluginPackage,
  useActiveDocument,
  useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import {
  GlobalPointerProvider,
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from "@embedpdf/plugin-interaction-manager/react";
import {
  RenderLayer,
  RenderPluginPackage,
} from "@embedpdf/plugin-render/react";
import { Rotate, RotatePluginPackage } from "@embedpdf/plugin-rotate/react";
import {
  type PageLayout,
  type ScrollerLayout,
  ScrollPluginPackage,
  ScrollStrategy,
  useScroll,
  useScrollPlugin,
  type VirtualItem,
} from "@embedpdf/plugin-scroll/react";
import {
  SearchLayer,
  SearchPluginPackage,
  useSearch,
} from "@embedpdf/plugin-search/react";
import {
  CopyToClipboard,
  SelectionPluginPackage,
  useSelectionCapability,
  useSelectionPlugin,
} from "@embedpdf/plugin-selection/react";
import {
  ThumbImg,
  type ThumbMeta,
  ThumbnailPluginPackage,
  useThumbnailCapability,
  useThumbnailPlugin,
} from "@embedpdf/plugin-thumbnail/react";
import {
  TilingLayer,
  TilingPluginPackage,
} from "@embedpdf/plugin-tiling/react";
import {
  useIsViewportGated,
  useViewportCapability,
  useViewportElement,
  useViewportRef,
  ViewportElementContext,
  ViewportPluginPackage,
} from "@embedpdf/plugin-viewport/react";
import { useZoom, ZoomPluginPackage } from "@embedpdf/plugin-zoom/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Download01Icon,
  MinusSignCircleIcon,
  MoreHorizontalIcon,
  PlusSignCircleIcon,
  RotateClockwiseIcon,
  Search01Icon,
  SidebarLeftIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as React from "react";
import { flushSync } from "react-dom";

export type PDFViewerHandle = {
  getViewportElement: () => HTMLDivElement | null;
  scrollToPage: (pageNumber: number, options?: ScrollIntoViewOptions) => void;
  scrollToPageArea: (
    pageNumber: number,
    area: { height?: number; left?: number; top: number; width?: number },
    options?: ScrollToOptions,
  ) => void;
};

export type PDFViewerPageOverlayProps = {
  pageHeight: number;
  pageNumber: number;
  pageWidth: number;
  rotation: number;
  scale: number;
};

export type PDFViewerProps = {
  className?: string;
  defaultZoom?: number;
  fileName?: string;
  onActivePageChange?: (pageNumber: number) => void;
  onDocumentLoadSuccess?: (numPages: number) => void;
  onPagePointerCancel?: (
    event: React.PointerEvent<HTMLDivElement>,
    pageNumber: number,
  ) => void;
  onPagePointerDown?: (
    event: React.PointerEvent<HTMLDivElement>,
    pageNumber: number,
  ) => void;
  onPagePointerMove?: (
    event: React.PointerEvent<HTMLDivElement>,
    pageNumber: number,
  ) => void;
  onPagePointerUp?: (
    event: React.PointerEvent<HTMLDivElement>,
    pageNumber: number,
  ) => void;
  onPdfUpload?: (file: File) => void;
  pageClassName?: (pageNumber: number) => string | undefined;
  renderPageOverlay?: (props: PDFViewerPageOverlayProps) => React.ReactNode;
  showDownload?: boolean;
  showRotateControls?: boolean;
  showToolbar?: boolean;
  showUpload?: boolean;
  src?: string;
  toolbarActions?: React.ReactNode;
};

const DEFAULT_ZOOM = 1;
const ZOOM_OPTIONS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const MIN_ZOOM = Math.min(...ZOOM_OPTIONS);
const MAX_ZOOM = Math.max(...ZOOM_OPTIONS);
const PAGE_GAP = 24;
const THUMBNAIL_PAGE_WIDTH = 92;
const THUMBNAIL_IMAGE_PADDING = 8;
const THUMBNAIL_WIDTH = THUMBNAIL_PAGE_WIDTH + THUMBNAIL_IMAGE_PADDING * 2;
const THUMBNAIL_LABEL_HEIGHT = 24;
const THUMBNAIL_GAP = 12;
const THUMBNAIL_PANE_PADDING_Y = 16;
const THUMBNAIL_SIDEBAR_WIDTH_CLASS = "w-40";
const THUMBNAIL_SIDEBAR_CLOSED_CLASS = "-ml-40";
const PAGE_BASE_RENDER_MAX_SCALE = 1;
const PAGE_BASE_RENDER_DPR = 1;
const PDF_SEARCH_DEBOUNCE_MS = 300;
const TEXT_SELECTION_BACKGROUND = "rgba(59, 130, 246, 0.14)";
const THUMBNAIL_FOCUS_RING_CLASS =
  "group-focus-visible/pdf-thumbnail-sidebar:ring-2 group-focus-visible/pdf-thumbnail-sidebar:ring-ring group-focus-visible/pdf-thumbnail-sidebar:ring-offset-1 group-focus-visible/pdf-thumbnail-sidebar:ring-offset-background";

type PageRotationDeltas = Map<number, Rotation>;
type PDFViewerInnerProps = {
  className?: string;
  defaultZoom: number;
  document: null | PdfDocumentObject;
  documentId: string;
  fileName?: string;
  onActivePageChange?: (pageNumber: number) => void;
  onPagePointerCancel?: PDFViewerProps["onPagePointerCancel"];
  onPagePointerDown?: PDFViewerProps["onPagePointerDown"];
  onPagePointerMove?: PDFViewerProps["onPagePointerMove"];
  onPagePointerUp?: PDFViewerProps["onPagePointerUp"];
  onPdfUpload?: (file: File) => void;
  onUploadFile: (file: File) => void;
  pageClassName?: (pageNumber: number) => string | undefined;
  pdfFile: string;
  renderPageOverlay?: (props: PDFViewerPageOverlayProps) => React.ReactNode;
  showDownload: boolean;
  showRotateControls: boolean;
  showToolbar: boolean;
  showUpload: boolean;
  toolbarActions?: React.ReactNode;
  viewerRef: React.ForwardedRef<PDFViewerHandle>;
};

type ThumbnailSelectionMode = "range" | "replace" | "toggle";

function applyPageRotationDeltasToScrollerLayout({
  basePageRotations,
  layout,
  pageRotationDeltas,
}: {
  basePageRotations: Rotation[];
  layout: ScrollerLayout;
  pageRotationDeltas: PageRotationDeltas;
}): ScrollerLayout {
  if (pageRotationDeltas.size === 0) return layout;

  let maxWidth = 0;
  let maxHeight = 0;
  let offset = 0;
  const pageGap = layout.pageGap;
  let startSpacingAdjustment = 0;
  const items: VirtualItem[] = layout.items.map((item, itemIndex) => {
    let pageOffset = 0;
    let itemWidth = 0;
    let itemHeight = 0;
    const pageLayouts = item.pageLayouts.map((page) => {
      const basePageRotation =
        basePageRotations[page.pageIndex] ?? normalizeRotation(0);
      const pageRotation = normalizeRotation(
        basePageRotation + (pageRotationDeltas.get(page.pageIndex) ?? 0),
      );
      const rotatedSize = getRotatedPageDimensions(page, pageRotation);
      const oldScrollAxisSize =
        layout.strategy === ScrollStrategy.Horizontal
          ? page.rotatedWidth
          : page.rotatedHeight;
      const newScrollAxisSize =
        layout.strategy === ScrollStrategy.Horizontal
          ? rotatedSize.width
          : rotatedSize.height;

      if (
        layout.startSpacing === 0 &&
        itemIndex === 0 &&
        pageOffset === 0 &&
        newScrollAxisSize < oldScrollAxisSize
      ) {
        startSpacingAdjustment = Math.max(
          startSpacingAdjustment,
          (oldScrollAxisSize - newScrollAxisSize) / 2,
        );
      }

      const nextPageLayout = {
        ...page,
        rotatedHeight: rotatedSize.height,
        rotatedWidth: rotatedSize.width,
        x: layout.strategy === ScrollStrategy.Horizontal ? 0 : pageOffset,
        y: layout.strategy === ScrollStrategy.Horizontal ? pageOffset : 0,
      };

      pageOffset +=
        (layout.strategy === ScrollStrategy.Horizontal
          ? rotatedSize.height
          : rotatedSize.width) + pageGap;
      itemWidth =
        layout.strategy === ScrollStrategy.Horizontal
          ? Math.max(itemWidth, rotatedSize.width)
          : itemWidth + rotatedSize.width;
      itemHeight =
        layout.strategy === ScrollStrategy.Horizontal
          ? itemHeight + rotatedSize.height
          : Math.max(itemHeight, rotatedSize.height);

      return nextPageLayout;
    });

    if (pageLayouts.length > 1) {
      if (layout.strategy === ScrollStrategy.Horizontal) {
        itemHeight -= pageGap;
      } else {
        itemWidth -= pageGap;
      }
    }

    const nextItem = {
      ...item,
      height: itemHeight,
      offset,
      pageLayouts,
      width: itemWidth,
      x: layout.strategy === ScrollStrategy.Horizontal ? offset : item.x,
      y: layout.strategy === ScrollStrategy.Horizontal ? item.y : offset,
    };

    if (layout.strategy === ScrollStrategy.Horizontal) {
      offset += itemWidth + pageGap;
      maxHeight = Math.max(maxHeight, itemHeight);
    } else {
      offset += itemHeight + pageGap;
      maxWidth = Math.max(maxWidth, itemWidth);
    }

    return nextItem;
  });

  if (items.length > 0) {
    offset -= pageGap;
  }

  return {
    ...layout,
    endSpacing: layout.endSpacing,
    items,
    startSpacing: layout.startSpacing + startSpacingAdjustment,
    totalHeight:
      layout.strategy === ScrollStrategy.Horizontal
        ? maxHeight
        : layout.startSpacing +
          startSpacingAdjustment +
          offset +
          layout.endSpacing,
    totalWidth:
      layout.strategy === ScrollStrategy.Horizontal
        ? layout.startSpacing +
          startSpacingAdjustment +
          offset +
          layout.endSpacing
        : maxWidth,
  };
}

function arePageIndexSetsEqual(left: Set<number>, right: Set<number>) {
  if (left.size !== right.size) return false;

  for (const value of left) {
    if (!right.has(value)) return false;
  }

  return true;
}

function buildThumbnailLayout({
  basePageRotations,
  gap,
  imagePadding,
  labelHeight,
  paddingY,
  pageRotationDeltas,
  pdfDocument,
  width,
}: {
  basePageRotations: Rotation[];
  gap: number;
  imagePadding: number;
  labelHeight: number;
  paddingY: number;
  pageRotationDeltas: PageRotationDeltas;
  pdfDocument: null | PdfDocumentObject;
  width: number;
}) {
  if (!pdfDocument) return null;

  let top = paddingY;
  const items = pdfDocument.pages.map((page, pageIndex) => {
    const basePageRotation =
      basePageRotations[pageIndex] ?? normalizeRotation(page.rotation);
    const pageRotation = normalizeRotation(
      basePageRotation + (pageRotationDeltas.get(pageIndex) ?? 0),
    );
    const meta = getThumbnailMetaForPage({
      imagePadding,
      labelHeight,
      page,
      pageIndex,
      rotation: pageRotation,
      top,
      width,
    });

    top += meta.wrapperHeight + gap;
    return meta;
  });

  return {
    items,
    totalHeight: items.length > 0 ? top - gap + paddingY : paddingY * 2,
  };
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

async function downloadPdfWithPageRotations({
  fileName,
  pageRotationDeltas,
  src,
}: {
  fileName: string;
  pageRotationDeltas: PageRotationDeltas;
  src: string;
}) {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error(`Failed to download PDF (${response.status})`);
  }

  if (pageRotationDeltas.size === 0) {
    downloadBlob(await response.blob(), fileName);
    return;
  }

  const [{ degrees, PDFDocument }, pdfBytes] = await Promise.all([
    import("pdf-lib"),
    response.arrayBuffer(),
  ]);
  const pdfDocument = await PDFDocument.load(pdfBytes);

  for (const [pageIndex, page] of pdfDocument.getPages().entries()) {
    const rotationDelta = pageRotationDeltas.get(pageIndex);

    if (!rotationDelta) continue;

    page.setRotation(
      degrees(
        normalizeDegrees(
          page.getRotation().angle + rotationToDegrees(rotationDelta),
        ),
      ),
    );
  }

  const nextPdfBytes = await pdfDocument.save();
  const nextPdfBuffer = new ArrayBuffer(nextPdfBytes.byteLength);
  new Uint8Array(nextPdfBuffer).set(nextPdfBytes);

  downloadBlob(
    new Blob([nextPdfBuffer], { type: "application/pdf" }),
    getRotatedPdfDownloadFileName(fileName),
  );
}

function ensurePdfExtension(fileName: string) {
  return fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
}

function getPageIndexRange(from: number, to: number): Set<number> {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const range = new Set<number>();

  for (let pageIndex = start; pageIndex <= end; pageIndex += 1) {
    range.add(pageIndex);
  }

  return range;
}

function getPdfDownloadFileName(fileName: string | undefined, src: string) {
  if (fileName?.trim()) return ensurePdfExtension(fileName.trim());

  const pathname = src.split(/[?#]/)[0] ?? "";
  const rawName = pathname.split("/").pop() || "document.pdf";

  try {
    return ensurePdfExtension(decodeURIComponent(rawName));
  } catch {
    return ensurePdfExtension(rawName);
  }
}

function getRotatedDimensions({
  height,
  rotation,
  width,
}: {
  height: number;
  rotation: Rotation;
  width: number;
}) {
  return isQuarterTurn(rotation)
    ? { height: width, width: height }
    : { height, width };
}

function getRotatedPageDimensions(page: PageLayout, rotation: Rotation) {
  return getRotatedDimensions({
    height: page.height,
    rotation,
    width: page.width,
  });
}

function getRotatedPdfDownloadFileName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "-rotated.pdf");
}

function getThumbnailMetaForPage({
  imagePadding,
  labelHeight,
  page,
  pageIndex,
  rotation,
  top,
  width,
}: {
  imagePadding: number;
  labelHeight: number;
  page: PdfDocumentObject["pages"][number];
  pageIndex: number;
  rotation: Rotation;
  top: number;
  width: number;
}): ThumbMeta {
  const innerWidth = Math.max(1, width - imagePadding * 2);
  const pageWidth = rotation % 2 === 1 ? page.size.height : page.size.width;
  const pageHeight = rotation % 2 === 1 ? page.size.width : page.size.height;
  const imageHeight = Math.round(innerWidth * (pageHeight / pageWidth));
  const wrapperHeight = imagePadding + imageHeight + imagePadding + labelHeight;

  return {
    height: imageHeight,
    labelHeight,
    padding: imagePadding,
    pageIndex,
    top,
    width: innerWidth,
    wrapperHeight,
  };
}

function getVisibleThumbnailItems({
  buffer,
  clientHeight,
  items,
  scrollTop,
}: {
  buffer: number;
  clientHeight: number;
  items: ThumbMeta[];
  scrollTop: number;
}) {
  if (items.length === 0) return [];
  if (clientHeight <= 0)
    return items.slice(0, Math.min(items.length, buffer * 2));

  const viewportBottom = scrollTop + clientHeight;
  let start = items.findIndex(
    (item) => item.top + item.wrapperHeight >= scrollTop,
  );

  if (start === -1) start = items.length - 1;

  let end = start;
  while (
    end < items.length &&
    (items[end]?.top ?? Infinity) <= viewportBottom
  ) {
    end += 1;
  }

  return items.slice(
    Math.max(0, start - buffer),
    Math.min(items.length, end + buffer),
  );
}

// The copy shortcut listens on the document because a mouse selection leaves
// focus on `body`, but the viewer is only one panel of a larger app and several
// viewers stay mounted at once. A live DOM selection anywhere outside this
// viewer's own subtree belongs to whatever the user actually highlighted, so
// the PDF's selection must not answer for it.
function hasDomSelectionOutside(shell: HTMLElement | null) {
  const domSelection = window.getSelection();

  if (!domSelection || domSelection.isCollapsed || !domSelection.rangeCount) {
    return false;
  }

  const range = domSelection.getRangeAt(0);

  return !shell?.contains(range.commonAncestorContainer);
}

function isEditableCopyTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  if (target.isContentEditable) return true;

  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function isQuarterTurn(rotation: Rotation) {
  return rotation % 2 === 1;
}

function normalizeDegrees(rotation: number) {
  return ((rotation % 360) + 360) % 360;
}

function normalizeRotation(rotation: number): Rotation {
  return (((rotation % 4) + 4) % 4) as Rotation;
}

function PDFViewerDocumentLoader({
  onDocumentLoadSuccess,
  pdfFile,
  ...innerProps
}: Omit<PDFViewerInnerProps, "document" | "documentId" | "pdfFile"> & {
  onDocumentLoadSuccess?: (numPages: number) => void;
  pdfFile: string;
}) {
  const { provides: documentManager } = useDocumentManagerCapability();
  const { activeDocument, activeDocumentId } = useActiveDocument();
  const [loadError, setLoadError] = React.useState(false);
  const openedFileRef = React.useRef<null | string>(null);
  const onDocumentLoadSuccessRef = React.useRef(onDocumentLoadSuccess);

  React.useEffect(() => {
    onDocumentLoadSuccessRef.current = onDocumentLoadSuccess;
  });

  React.useEffect(() => {
    if (!documentManager || !pdfFile) return;
    if (openedFileRef.current === pdfFile) return;

    openedFileRef.current = pdfFile;
    setLoadError(false);

    const previousDocumentIds = documentManager
      .getOpenDocuments()
      .map((openDocument) => openDocument.id);
    const handleOpenError = () => {
      if (openedFileRef.current === pdfFile) setLoadError(true);
    };

    documentManager
      .openDocumentUrl({
        mode: pdfFile.startsWith("blob:") ? "full-fetch" : "auto",
        url: pdfFile,
      })
      .wait((response) => {
        response.task.wait((openedDocument) => {
          onDocumentLoadSuccessRef.current?.(openedDocument.pageCount);
          for (const documentIdToClose of previousDocumentIds) {
            documentManager.closeDocument(documentIdToClose).wait(
              () => {},
              () => {},
            );
          }
        }, handleOpenError);
      }, handleOpenError);
  }, [documentManager, pdfFile]);

  const document =
    activeDocument?.status === "loaded" ? activeDocument.document : null;
  const documentFailed = loadError || activeDocument?.status === "error";

  if (!activeDocumentId || documentFailed || !pdfFile) {
    return (
      <PDFViewerFallbackShell
        className={innerProps.className}
        onUploadFile={(file) => {
          innerProps.onUploadFile(file);
          innerProps.onPdfUpload?.(file);
        }}
        showToolbar={innerProps.showToolbar}
        showUpload={innerProps.showUpload}
        sidebarOpen={false}
        state={pdfFile ? (documentFailed ? "error" : "loading") : "empty"}
      />
    );
  }

  return (
    <PDFViewerInner
      key={activeDocumentId}
      {...innerProps}
      document={document}
      documentId={activeDocumentId}
      pdfFile={pdfFile}
    />
  );
}

// Rendered while the engine or document is not ready: same frame as the
// full viewer, with only the upload control usable.
function PDFViewerFallbackShell({
  className,
  onUploadFile,
  showToolbar,
  showUpload,
  sidebarOpen,
  state,
}: {
  className?: string;
  onUploadFile?: (file: File) => void;
  showToolbar: boolean;
  showUpload: boolean;
  sidebarOpen: boolean;
  state: "empty" | "error" | "loading";
}) {
  return (
    <div
      className={cn(
        "flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
      data-slot="pdf-viewer"
    >
      {showToolbar ? (
        <div className="flex min-h-12 flex-wrap items-center justify-end gap-2 border-b bg-background px-3 py-2">
          {showUpload && onUploadFile ? (
            <PDFViewerFileActionsMenu onUploadFile={onUploadFile} showUpload />
          ) : null}
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-muted/30">
        {state === "loading" ? (
          <PDFViewerLoadingSkeleton sidebarInline sidebarOpen={sidebarOpen} />
        ) : null}
        {state === "error" ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-background p-6 text-sm text-muted-foreground">
            Unable to load the PDF preview.
          </div>
        ) : null}
        {state === "empty" ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-background p-6 text-center text-sm text-muted-foreground">
            <div className="max-w-sm space-y-3">
              <div className="font-medium text-foreground">
                Upload a PDF to preview
              </div>
              <div>
                Pass a PDF URL with the <code>src</code> prop or use the upload
                control.
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PDFViewerFileActionsMenu({
  downloadDisabled,
  isPreparingDownload = false,
  onDownload,
  onUploadFile,
  showDownload = false,
  showUpload = false,
}: {
  downloadDisabled?: boolean;
  isPreparingDownload?: boolean;
  onDownload?: () => void;
  onUploadFile?: (file: File) => void;
  showDownload?: boolean;
  showUpload?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  if (!showDownload && !showUpload) return null;

  return (
    <>
      {showUpload && onUploadFile ? (
        <input
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => {
            const nextFile = event.target.files?.[0];

            if (nextFile) {
              onUploadFile(nextFile);
              event.currentTarget.value = "";
            }
          }}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Open PDF actions"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon className="size-4" icon={MoreHorizontalIcon} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {showDownload && onDownload ? (
            <DropdownMenuItem disabled={downloadDisabled} onClick={onDownload}>
              {isPreparingDownload ? (
                <Spinner className="size-4" />
              ) : (
                <HugeiconsIcon className="size-4" icon={Download01Icon} />
              )}
              Download
            </DropdownMenuItem>
          ) : null}
          {showUpload && onUploadFile ? (
            <DropdownMenuItem onClick={() => inputRef.current?.click()}>
              <HugeiconsIcon className="size-4" icon={Upload01Icon} />
              Upload
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function PDFViewerInner({
  className,
  defaultZoom,
  document: pdfDocument,
  documentId,
  fileName,
  onActivePageChange,
  onPagePointerCancel,
  onPagePointerDown,
  onPagePointerMove,
  onPagePointerUp,
  onPdfUpload,
  onUploadFile,
  pageClassName,
  pdfFile,
  renderPageOverlay,
  showDownload,
  showRotateControls,
  showToolbar,
  showUpload,
  toolbarActions,
  viewerRef,
}: PDFViewerInnerProps) {
  const { registry } = useRegistry();
  const { provides: scroll, state: scrollState } = useScroll(documentId);
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { provides: thumbnails } = useThumbnailCapability();
  const { plugin: thumbnailPlugin } = useThumbnailPlugin();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [isPreparingDownload, setIsPreparingDownload] = React.useState(false);
  const [pageRotationDeltas, setPageRotationDeltas] =
    React.useState<PageRotationDeltas>(() => new Map());
  const [selectedPageIndexes, setSelectedPageIndexes] = React.useState<
    Set<number>
  >(() => new Set());
  const basePageRotations = React.useMemo(
    () =>
      pdfDocument?.pages.map((page) => normalizeRotation(page.rotation)) ?? [],
    [pdfDocument],
  );
  const [viewerShellRef, viewerShellWidth] = useElementWidth<HTMLDivElement>();
  const sidebarInline = useInlineThumbnailSidebar(viewerShellWidth);
  const viewportElementRef = React.useRef<HTMLDivElement | null>(null);
  const pageRotationDeltasRef = React.useRef(pageRotationDeltas);
  const selectedPageIndexesRef = React.useRef(selectedPageIndexes);
  const selectionAnchorPageIndexRef = React.useRef<null | number>(null);
  const suppressActivePageSelectionSyncRef = React.useRef<null | number>(null);
  const initializedSelectionDocumentRef = React.useRef<null | string>(null);

  const activePage = scrollState.currentPage;
  const numPages = pdfDocument?.pageCount ?? 0;
  const isLoading = !pdfDocument;
  const controlsDisabled = !numPages;
  const downloadDisabled = controlsDisabled || isPreparingDownload;
  const thumbnailSidebarVisible = sidebarOpen && !isLoading;
  const currentZoomLevel = zoomState.currentZoomLevel;
  const alignedThumbnailSidebarDocumentRef = React.useRef<null | string>(null);

  React.useEffect(() => {
    pageRotationDeltasRef.current = pageRotationDeltas;
  }, [pageRotationDeltas]);

  React.useEffect(() => {
    selectedPageIndexesRef.current = selectedPageIndexes;
  }, [selectedPageIndexes]);

  React.useEffect(() => {
    if (activePage > 0) onActivePageChange?.(activePage);
  }, [activePage, onActivePageChange]);

  React.useEffect(() => {
    if (activePage < 1 || numPages < 1) return;

    const activePageIndex = activePage - 1;
    const suppressedPageIndex = suppressActivePageSelectionSyncRef.current;

    suppressActivePageSelectionSyncRef.current = null;

    if (suppressedPageIndex === activePageIndex) return;

    const nextSelection = new Set([activePageIndex]);

    selectionAnchorPageIndexRef.current = activePageIndex;
    selectedPageIndexesRef.current = nextSelection;
    setSelectedPageIndexes((previousSelection) =>
      arePageIndexSetsEqual(previousSelection, nextSelection)
        ? previousSelection
        : nextSelection,
    );
  }, [activePage, numPages]);

  React.useEffect(() => {
    if (
      numPages < 1 ||
      initializedSelectionDocumentRef.current === documentId
    ) {
      return;
    }

    const initialPageIndex = Math.max(0, (activePage > 0 ? activePage : 1) - 1);
    const initialSelection = new Set([initialPageIndex]);

    initializedSelectionDocumentRef.current = documentId;
    selectionAnchorPageIndexRef.current = initialPageIndex;
    selectedPageIndexesRef.current = initialSelection;
    setSelectedPageIndexes(initialSelection);
  }, [activePage, documentId, numPages]);

  React.useEffect(() => {
    if (!thumbnailSidebarVisible) {
      alignedThumbnailSidebarDocumentRef.current = null;
      return;
    }

    if (
      activePage < 1 ||
      !thumbnails ||
      alignedThumbnailSidebarDocumentRef.current === documentId
    ) {
      return;
    }

    alignedThumbnailSidebarDocumentRef.current = documentId;
    const frame = window.requestAnimationFrame(() => {
      thumbnails.forDocument(documentId).scrollToThumb(activePage - 1);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePage, documentId, thumbnailSidebarVisible, thumbnails]);

  // The zoom plugin only releases its viewport gate for mode-based zoom
  // levels (automatic/fit); with a numeric default the gate would never
  // lift, so apply the initial zoom explicitly once the document loads.
  const initialZoomDocumentRef = React.useRef<null | string>(null);
  React.useEffect(() => {
    if (!pdfDocument || !zoom) return;
    if (initialZoomDocumentRef.current === documentId) return;

    initialZoomDocumentRef.current = documentId;
    zoom.requestZoom(defaultZoom);
  }, [defaultZoom, documentId, pdfDocument, zoom]);

  const scrollToPage = React.useCallback(
    (pageNumber: number, options?: ScrollIntoViewOptions) => {
      scroll?.scrollToPage({
        behavior: options?.behavior === "smooth" ? "smooth" : "auto",
        pageNumber,
      });
    },
    [scroll],
  );

  const selectThumbnailPage = React.useCallback(
    (pageNumber: number, mode: ThumbnailSelectionMode) => {
      const pageIndex = pageNumber - 1;

      if (pageIndex < 0 || pageIndex >= numPages) return;

      suppressActivePageSelectionSyncRef.current = pageIndex;

      setSelectedPageIndexes((previousSelection) => {
        let nextSelection: Set<number>;

        if (mode === "range") {
          const anchorPageIndex =
            selectionAnchorPageIndexRef.current ??
            (activePage > 0 ? activePage - 1 : pageIndex);

          nextSelection = getPageIndexRange(anchorPageIndex, pageIndex);
        } else if (mode === "toggle") {
          nextSelection = new Set(previousSelection);

          if (nextSelection.has(pageIndex)) {
            nextSelection.delete(pageIndex);
          } else {
            nextSelection.add(pageIndex);
          }

          selectionAnchorPageIndexRef.current = pageIndex;
        } else {
          nextSelection = new Set([pageIndex]);
          selectionAnchorPageIndexRef.current = pageIndex;
        }

        selectedPageIndexesRef.current = nextSelection;
        return nextSelection;
      });

      scrollToPage(pageNumber);
    },
    [activePage, numPages, scrollToPage],
  );

  React.useImperativeHandle(
    viewerRef,
    () => ({
      getViewportElement: () => viewportElementRef.current,
      scrollToPage,
      scrollToPageArea: (pageNumber, area, options) => {
        const pageSize = pdfDocument?.pages[pageNumber - 1]?.size;

        scroll?.scrollToPage({
          pageNumber,
          ...(pageSize
            ? {
                alignY: 25,
                pageCoordinates: {
                  x: ((area.left ?? 0) / 100) * pageSize.width,
                  y: (area.top / 100) * pageSize.height,
                },
              }
            : {}),
          behavior: options?.behavior === "smooth" ? "smooth" : "auto",
        });
      },
    }),
    [pdfDocument, scroll, scrollToPage],
  );

  const handleDownload = React.useCallback(async () => {
    if (!pdfFile || isPreparingDownload) return;

    setIsPreparingDownload(true);

    try {
      await downloadPdfWithPageRotations({
        fileName: getPdfDownloadFileName(fileName, pdfFile),
        pageRotationDeltas,
        src: pdfFile,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsPreparingDownload(false);
    }
  }, [fileName, isPreparingDownload, pageRotationDeltas, pdfFile]);

  const rotateSelectedPages = React.useCallback(
    (direction: -1 | 1) => {
      if (!pdfDocument || !registry || activePage < 1) return;

      const documentState = registry.getStore().getState().core.documents[
        documentId
      ];
      const currentDocument = documentState?.document ?? pdfDocument;
      const selectedTargetPageIndexes = [
        ...selectedPageIndexesRef.current,
      ].filter((pageIndex) => currentDocument.pages[pageIndex]);
      const fallbackPageIndex = activePage - 1;
      const targetPageIndexes = (
        selectedTargetPageIndexes.length > 0
          ? selectedTargetPageIndexes
          : [fallbackPageIndex]
      )
        .filter((pageIndex) => currentDocument.pages[pageIndex])
        .sort((a, b) => a - b);

      if (targetPageIndexes.length === 0) return;

      const previousDeltas = pageRotationDeltasRef.current;
      const nextDeltas = new Map(previousDeltas);
      const referencePageIndex =
        activePage > 0 && currentDocument.pages[activePage - 1]
          ? activePage - 1
          : (targetPageIndexes[0] ?? fallbackPageIndex);
      let scrollDelta = 0;

      for (const pageIndex of targetPageIndexes) {
        const currentPage = currentDocument.pages[pageIndex];
        if (!currentPage) continue;

        const previousDelta = previousDeltas.get(pageIndex) ?? 0;
        const nextDelta = normalizeRotation(previousDelta + direction);
        const basePageRotation =
          basePageRotations[pageIndex] ??
          normalizeRotation(currentPage.rotation);
        const previousPageRotation = normalizeRotation(
          basePageRotation + previousDelta,
        );
        const nextPageRotation = normalizeRotation(
          basePageRotation + nextDelta,
        );
        const previousRotatedSize = getRotatedDimensions({
          height: currentPage.size.height * currentZoomLevel,
          rotation: previousPageRotation,
          width: currentPage.size.width * currentZoomLevel,
        });
        const nextRotatedSize = getRotatedDimensions({
          height: currentPage.size.height * currentZoomLevel,
          rotation: nextPageRotation,
          width: currentPage.size.width * currentZoomLevel,
        });
        const heightDelta = nextRotatedSize.height - previousRotatedSize.height;

        if (pageIndex < referencePageIndex) {
          scrollDelta += heightDelta;
        } else if (pageIndex === referencePageIndex) {
          scrollDelta += heightDelta / 2;
        }

        if (nextDelta) {
          nextDeltas.set(pageIndex, nextDelta);
        } else {
          nextDeltas.delete(pageIndex);
        }
      }

      const store = registry.getStore();
      const viewport = viewportElementRef.current;

      pageRotationDeltasRef.current = nextDeltas;
      flushSync(() => {
        setPageRotationDeltas(nextDeltas);
        store.dispatchToCore(refreshPages(documentId, targetPageIndexes));
      });

      if (viewport && scrollDelta !== 0) {
        viewport.scrollTop += scrollDelta;
      }
      (
        thumbnailPlugin as null | {
          calculateWindowState?: (documentId: string) => void;
        }
      )?.calculateWindowState?.(documentId);
    },
    [
      activePage,
      basePageRotations,
      currentZoomLevel,
      documentId,
      pdfDocument,
      registry,
      thumbnailPlugin,
    ],
  );

  const handleUpload = React.useCallback(
    (file: File) => {
      onUploadFile(file);
      onPdfUpload?.(file);
    },
    [onPdfUpload, onUploadFile],
  );

  const renderPage = React.useCallback(
    (page: PageLayout) => {
      const pageNumber = page.pageNumber;
      const basePageRotation =
        basePageRotations[page.pageIndex] ??
        pdfDocument?.pages[page.pageIndex]?.rotation ??
        normalizeRotation(0);
      const pageRotation = normalizeRotation(
        basePageRotation + (pageRotationDeltas.get(page.pageIndex) ?? 0),
      );

      return (
        <Rotate
          documentId={documentId}
          pageIndex={page.pageIndex}
          rotation={pageRotation}
        >
          <PagePointerProvider
            className={cn(
              "relative border border-transparent bg-transparent shadow-xs select-none selection:bg-transparent selection:text-inherit",
              pageClassName?.(pageNumber),
            )}
            data-pdf-viewer-page={pageNumber}
            documentId={documentId}
            key={`${page.pageIndex}-${pageRotation}`}
            onPointerCancel={(event: React.PointerEvent<HTMLDivElement>) =>
              onPagePointerCancel?.(event, pageNumber)
            }
            onPointerDown={(event: React.PointerEvent<HTMLDivElement>) =>
              onPagePointerDown?.(event, pageNumber)
            }
            onPointerMove={(event: React.PointerEvent<HTMLDivElement>) =>
              onPagePointerMove?.(event, pageNumber)
            }
            onPointerUp={(event: React.PointerEvent<HTMLDivElement>) =>
              onPagePointerUp?.(event, pageNumber)
            }
            pageIndex={page.pageIndex}
            rotation={pageRotation}
            style={{ backgroundColor: "transparent" }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-white"
            />
            <RenderLayer
              className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-100 blur-[0.35px] transition-none"
              documentId={documentId}
              dpr={PAGE_BASE_RENDER_DPR}
              pageIndex={page.pageIndex}
              scale={Math.min(currentZoomLevel, PAGE_BASE_RENDER_MAX_SCALE)}
            />
            <TilingLayer
              className="pointer-events-none opacity-100 transition-none [&_img]:opacity-100 [&_img]:transition-none"
              documentId={documentId}
              key={`tiles-${page.pageIndex}-${pageRotation}`}
              pageIndex={page.pageIndex}
            />
            <SearchLayer
              activeHighlightColor="rgba(249, 115, 22, 0.55)"
              className="pointer-events-none"
              documentId={documentId}
              highlightColor="rgba(253, 224, 71, 0.45)"
              pageIndex={page.pageIndex}
            />
            <PDFViewerTextSelectionLayer
              documentId={documentId}
              pageIndex={page.pageIndex}
              scale={currentZoomLevel}
            />
            {renderPageOverlay?.({
              pageHeight: page.height,
              pageNumber,
              pageWidth: page.width,
              rotation: rotationToDegrees(pageRotation),
              scale: currentZoomLevel,
            })}
          </PagePointerProvider>
        </Rotate>
      );
    },
    [
      basePageRotations,
      currentZoomLevel,
      onPagePointerCancel,
      onPagePointerDown,
      onPagePointerMove,
      onPagePointerUp,
      pageClassName,
      pageRotationDeltas,
      renderPageOverlay,
      documentId,
      pdfDocument,
    ],
  );

  return (
    <div
      className={cn(
        "flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
      data-slot="pdf-viewer"
    >
      {showToolbar ? (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <TooltipProvider>
              <ToolbarTooltip label="Toggle thumbnails">
                <Button
                  aria-label="Toggle thumbnails"
                  disabled={controlsDisabled}
                  onClick={() => setSidebarOpen((open) => !open)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon className="size-4" icon={SidebarLeftIcon} />
                </Button>
              </ToolbarTooltip>
            </TooltipProvider>
            <PDFViewerPageNumberControl
              activePage={activePage}
              controlsDisabled={controlsDisabled}
              numPages={numPages}
              onPageChange={scrollToPage}
            />
          </div>
          <TooltipProvider>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
              {showRotateControls ? (
                <>
                  <div className="flex flex-none items-center gap-1">
                    <ToolbarTooltip label="Rotate counterclockwise">
                      <Button
                        aria-label="Rotate counterclockwise"
                        disabled={controlsDisabled}
                        onClick={() => rotateSelectedPages(-1)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <HugeiconsIcon
                          className="size-4"
                          icon={RotateClockwiseIcon}
                        />
                      </Button>
                    </ToolbarTooltip>
                    <ToolbarTooltip label="Rotate clockwise">
                      <Button
                        aria-label="Rotate clockwise"
                        disabled={controlsDisabled}
                        onClick={() => rotateSelectedPages(1)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <HugeiconsIcon
                          className="size-4 -scale-x-100"
                          icon={RotateClockwiseIcon}
                        />
                      </Button>
                    </ToolbarTooltip>
                  </div>
                  <Separator
                    className="mx-1 h-4 self-center"
                    orientation="vertical"
                  />
                </>
              ) : null}
              <div className="flex flex-none items-center gap-1">
                <ToolbarTooltip label="Zoom out">
                  <Button
                    aria-label="Zoom out"
                    disabled={controlsDisabled || currentZoomLevel <= MIN_ZOOM}
                    onClick={() => {
                      const nextZoom = [...ZOOM_OPTIONS]
                        .reverse()
                        .find((option) => option < currentZoomLevel);

                      zoom?.requestZoom(nextZoom ?? MIN_ZOOM);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon
                      className="size-4"
                      icon={MinusSignCircleIcon}
                    />
                  </Button>
                </ToolbarTooltip>
                <Select
                  disabled={controlsDisabled}
                  modal={false}
                  onValueChange={(value) => zoom?.requestZoom(Number(value))}
                  value={String(currentZoomLevel)}
                >
                  <SelectTrigger className="w-[84px] min-w-[84px]" size="sm">
                    <SelectValue placeholder="Zoom">
                      {Math.round(currentZoomLevel * 100)}%
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {ZOOM_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {Math.round(option * 100)}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ToolbarTooltip label="Zoom in">
                  <Button
                    aria-label="Zoom in"
                    disabled={controlsDisabled || currentZoomLevel >= MAX_ZOOM}
                    onClick={() => {
                      const nextZoom = ZOOM_OPTIONS.find(
                        (option) => option > currentZoomLevel,
                      );

                      zoom?.requestZoom(nextZoom ?? MAX_ZOOM);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon
                      className="size-4"
                      icon={PlusSignCircleIcon}
                    />
                  </Button>
                </ToolbarTooltip>
              </div>
              <Separator
                className="mx-1 h-4 self-center"
                orientation="vertical"
              />
              <PDFViewerSearchControl
                controlsDisabled={controlsDisabled}
                documentId={documentId}
                key={documentId}
              />
              {toolbarActions ? (
                <>
                  <Separator
                    className="mx-1 h-4 self-center"
                    orientation="vertical"
                  />
                  {toolbarActions}
                </>
              ) : null}
              {showDownload || showUpload ? (
                <>
                  <Separator
                    className="mx-1 h-4 self-center"
                    orientation="vertical"
                  />
                  <PDFViewerFileActionsMenu
                    downloadDisabled={downloadDisabled}
                    isPreparingDownload={isPreparingDownload}
                    onDownload={handleDownload}
                    onUploadFile={handleUpload}
                    showDownload={showDownload}
                    showUpload={showUpload}
                  />
                </>
              ) : null}
            </div>
          </TooltipProvider>
        </div>
      ) : null}
      <div
        className="relative flex min-h-0 flex-1 overflow-hidden bg-muted/30"
        ref={viewerShellRef}
      >
        {isLoading ? (
          <PDFViewerLoadingSkeleton
            sidebarInline={sidebarInline}
            sidebarOpen={sidebarOpen}
          />
        ) : null}
        <div className="flex h-full max-h-full min-h-0 w-full flex-1 overflow-hidden">
          <DocumentViewerThumbnailSidebar
            closedInlineClassName={THUMBNAIL_SIDEBAR_CLOSED_CLASS}
            inline={sidebarInline}
            open={thumbnailSidebarVisible}
            widthClassName={THUMBNAIL_SIDEBAR_WIDTH_CLASS}
          >
            {thumbnailSidebarVisible ? (
              <PDFViewerThumbnails
                activePage={activePage}
                basePageRotations={basePageRotations}
                documentId={documentId}
                onSelectPage={selectThumbnailPage}
                pageCount={numPages}
                pageRotationDeltas={pageRotationDeltas}
                pdfDocument={pdfDocument}
                selectedPageIndexes={selectedPageIndexes}
              />
            ) : null}
          </DocumentViewerThumbnailSidebar>
          <PDFViewerScrollAreaViewport
            className="relative h-full max-h-full min-h-0 min-w-0 flex-1"
            documentId={documentId}
          >
            <PDFViewerViewportBridge viewportElementRef={viewportElementRef} />
            <PDFViewerSelectionCopyShortcut
              documentId={documentId}
              viewerShellRef={viewerShellRef}
            />
            <PDFViewerSelectionReleaseGuard documentId={documentId} />
            <GlobalPointerProvider documentId={documentId}>
              <PDFViewerScroller
                basePageRotations={basePageRotations}
                documentId={documentId}
                pageRotationDeltas={pageRotationDeltas}
                renderPage={renderPage}
              />
            </GlobalPointerProvider>
            <CopyToClipboard />
          </PDFViewerScrollAreaViewport>
        </div>
      </div>
    </div>
  );
}

function PDFViewerLoadingSkeleton({
  sidebarInline,
  sidebarOpen,
}: {
  sidebarInline: boolean;
  sidebarOpen: boolean;
}) {
  return (
    <div className="absolute inset-0 z-20 flex bg-muted/30">
      {sidebarOpen ? (
        <DocumentViewerSidebarSkeleton
          className={THUMBNAIL_SIDEBAR_WIDTH_CLASS}
          inline={sidebarInline}
        />
      ) : null}
      <div className="grid min-w-0 flex-1 place-items-center">
        <Spinner className="size-4" />
      </div>
    </div>
  );
}

function PDFViewerPageNumberControl({
  activePage,
  controlsDisabled,
  numPages,
  onPageChange,
}: {
  activePage: number;
  controlsDisabled: boolean;
  numPages: number;
  onPageChange: (pageNumber: number) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const displayPage = numPages ? activePage : 1;
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftPage, setDraftPage] = React.useState(() => String(displayPage));

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

      onPageChange(Math.min(Math.max(parsedPage, 1), Math.max(numPages, 1)));
    },
    [numPages, onPageChange],
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
          disabled={controlsDisabled || !numPages}
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
      <span>of {numPages || "–"}</span>
    </div>
  );
}

function PDFViewerScrollAreaViewport({
  children,
  className,
  documentId,
}: {
  children: React.ReactNode;
  className?: string;
  documentId: string;
}) {
  const viewportRef = useViewportRef(documentId);
  const { provides: viewport } = useViewportCapability();
  const isGated = useIsViewportGated(documentId);
  const viewportGap = viewport?.getViewportGap() ?? 0;

  return (
    <ViewportElementContext.Provider value={viewportRef}>
      <ScrollArea
        className={className}
        orientation="both"
        viewportClassName="relative select-none selection:bg-transparent selection:text-inherit"
        viewportProps={{
          style: {
            padding: viewportGap,
          },
        }}
        viewportRef={viewportRef}
      >
        {isGated ? null : children}
      </ScrollArea>
    </ViewportElementContext.Provider>
  );
}

function PDFViewerScroller({
  basePageRotations,
  documentId,
  pageRotationDeltas,
  renderPage,
}: {
  basePageRotations: Rotation[];
  documentId: string;
  pageRotationDeltas: PageRotationDeltas;
  renderPage: (props: PageLayout) => React.ReactNode;
}) {
  const { plugin: scrollPlugin } = useScrollPlugin();
  const [layoutData, setLayoutData] = React.useState<{
    docId: null | string;
    layout: null | ScrollerLayout;
  }>({ docId: null, layout: null });

  React.useEffect(() => {
    if (!scrollPlugin || !documentId) return;
    let frame = 0;

    const setCurrentLayout = () => {
      try {
        setLayoutData({
          docId: documentId,
          layout: scrollPlugin.getScrollerLayout(documentId),
        });
      } catch {
        setLayoutData({ docId: documentId, layout: null });
      }
    };

    const unsubscribe = scrollPlugin.onScrollerData(documentId, (layout) => {
      setLayoutData({ docId: documentId, layout });
    });

    frame = window.requestAnimationFrame(setCurrentLayout);

    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
      setLayoutData({ docId: null, layout: null });
      scrollPlugin.clearLayoutReady(documentId);
    };
  }, [documentId, scrollPlugin]);

  const scrollerLayout = React.useMemo(() => {
    if (layoutData.docId !== documentId || !layoutData.layout) return null;

    return applyPageRotationDeltasToScrollerLayout({
      basePageRotations,
      layout: layoutData.layout,
      pageRotationDeltas,
    });
  }, [basePageRotations, documentId, layoutData, pageRotationDeltas]);

  React.useLayoutEffect(() => {
    if (!scrollPlugin || !documentId || !scrollerLayout) return;
    scrollPlugin.setLayoutReady(documentId);
  }, [documentId, scrollPlugin, scrollerLayout]);

  if (!scrollerLayout) return null;

  return (
    <div
      style={{
        boxSizing: "border-box",
        height: `${scrollerLayout.totalHeight}px`,
        margin: "0 auto",
        position: "relative",
        width: `${scrollerLayout.totalWidth}px`,
        ...(scrollerLayout.strategy === ScrollStrategy.Horizontal && {
          display: "flex",
          flexDirection: "row",
        }),
      }}
    >
      <div
        style={
          scrollerLayout.strategy === ScrollStrategy.Horizontal
            ? {
                flexShrink: 0,
                height: "100%",
                width: scrollerLayout.startSpacing,
              }
            : {
                height: scrollerLayout.startSpacing,
                width: "100%",
              }
        }
      />
      <div
        style={{
          alignItems: "center",
          boxSizing: "border-box",
          display: "flex",
          gap: scrollerLayout.pageGap,
          position: "relative",
          ...(scrollerLayout.strategy === ScrollStrategy.Horizontal
            ? {
                flexDirection: "row",
                minHeight: "100%",
              }
            : {
                flexDirection: "column",
                minWidth: "fit-content",
              }),
        }}
      >
        {scrollerLayout.items.map((item) => (
          <div
            key={item.pageNumbers[0]}
            style={{
              display: "flex",
              gap: scrollerLayout.pageGap,
              justifyContent: "center",
            }}
          >
            {item.pageLayouts.map((layout) => (
              <div
                key={layout.pageNumber}
                style={{
                  height: `${layout.rotatedHeight}px`,
                  position: "relative",
                  width: `${layout.rotatedWidth}px`,
                  zIndex: layout.elevated ? 1 : undefined,
                }}
              >
                {renderPage(layout)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        style={
          scrollerLayout.strategy === ScrollStrategy.Horizontal
            ? {
                flexShrink: 0,
                height: "100%",
                width: scrollerLayout.endSpacing,
              }
            : {
                height: scrollerLayout.endSpacing,
                width: "100%",
              }
        }
      />
    </div>
  );
}

function PDFViewerSearchControl({
  controlsDisabled,
  documentId,
}: {
  controlsDisabled: boolean;
  documentId: string;
}) {
  const { provides, state } = useSearch(documentId);
  const { provides: scroll } = useScroll(documentId);
  const [searchDraft, setSearchDraft] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isSearching, setIsSearching] = React.useState(false);
  const providesRef = React.useRef(provides);
  const scrollRef = React.useRef(scroll);
  const searchRequestIdRef = React.useRef(0);
  const hasActiveQuery = Boolean(searchQuery.trim());
  const resultLabel = isSearching
    ? "Searching"
    : hasActiveQuery
      ? state.total
        ? `${state.activeResultIndex + 1} / ${state.total}`
        : "No results"
      : "No search";

  const scrollToResult = React.useCallback(
    (index: number) => {
      const result = state.results[index];

      if (!result || !scroll) return;

      const firstRect = result.rects[0];

      scroll.scrollToPage({
        pageNumber: result.pageIndex + 1,
        ...(firstRect
          ? {
              alignY: 30,
              pageCoordinates: {
                x: firstRect.origin.x,
                y: firstRect.origin.y,
              },
            }
          : {}),
        behavior: "auto",
      });
    },
    [scroll, state.results],
  );

  React.useEffect(() => {
    providesRef.current = provides;
    scrollRef.current = scroll;
  }, [provides, scroll]);

  const runSearch = React.useCallback((rawQuery: string) => {
    const query = rawQuery.trim();
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchQuery(query);

    const searchProvider = providesRef.current;
    const scrollProvider = scrollRef.current;

    if (!searchProvider) {
      setIsSearching(false);
      return;
    }

    if (!query) {
      searchProvider.stopSearch();
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchProvider.startSearch();
    searchProvider.searchAllPages(query).wait(
      (result) => {
        if (searchRequestIdRef.current !== requestId) return;

        const firstResult = result.results[0];

        if (firstResult && scrollProvider) {
          searchProvider.goToResult(0);
          const firstRect = firstResult.rects[0];

          scrollProvider.scrollToPage({
            pageNumber: firstResult.pageIndex + 1,
            ...(firstRect
              ? {
                  alignY: 30,
                  pageCoordinates: {
                    x: firstRect.origin.x,
                    y: firstRect.origin.y,
                  },
                }
              : {}),
            behavior: "auto",
          });
        }
        setIsSearching(false);
      },
      () => {
        if (searchRequestIdRef.current !== requestId) return;
        setIsSearching(false);
      },
    );
  }, []);

  React.useEffect(() => {
    if (!searchDraft.trim()) return;

    const timeoutId = window.setTimeout(() => {
      runSearch(searchDraft);
    }, PDF_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [runSearch, searchDraft]);

  const handleSearchDraftChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextDraft = event.target.value;

      setSearchDraft(nextDraft);

      if (nextDraft.trim()) {
        setIsSearching(true);
        return;
      }

      searchRequestIdRef.current += 1;
      setSearchQuery("");
      setIsSearching(false);
      provides?.stopSearch();
    },
    [provides],
  );

  const clearSearch = React.useCallback(() => {
    searchRequestIdRef.current += 1;
    setSearchDraft("");
    setSearchQuery("");
    setIsSearching(false);
    provides?.stopSearch();
  }, [provides]);

  const navigate = React.useCallback(
    (direction: -1 | 1) => {
      if (!provides || state.total === 0) return;

      const index =
        direction === 1 ? provides.nextResult() : provides.previousResult();

      scrollToResult(index);
    },
    [provides, scrollToResult, state.total],
  );

  return (
    <Popover>
      <ToolbarTooltip label="Search text">
        <PopoverTrigger asChild>
          <Button
            aria-label="Search text"
            disabled={controlsDisabled}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon className="size-4" icon={Search01Icon} />
          </Button>
        </PopoverTrigger>
      </ToolbarTooltip>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <Input
            onChange={handleSearchDraftChange}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;

              event.preventDefault();
              if (event.shiftKey && state.total) {
                navigate(-1);
              } else if (state.total) {
                navigate(1);
              } else if (searchDraft.trim()) {
                runSearch(searchDraft);
              }
            }}
            placeholder="Search text"
            value={searchDraft}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-xs text-muted-foreground">
              <div className="truncate">
                {state.total ? (
                  <>
                    <span className="text-primary">
                      {state.activeResultIndex + 1}
                    </span>
                    {` / ${state.total}`}
                  </>
                ) : (
                  resultLabel
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label="Previous result"
                disabled={isSearching || state.total === 0}
                onClick={() => navigate(-1)}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <HugeiconsIcon className="size-4" icon={ArrowLeft01Icon} />
              </Button>
              <Button
                aria-label="Next result"
                disabled={isSearching || state.total === 0}
                onClick={() => navigate(1)}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <HugeiconsIcon className="size-4" icon={ArrowRight01Icon} />
              </Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={clearSearch}
              size="sm"
              type="button"
              variant="outline"
            >
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PDFViewerSelectionCopyShortcut({
  documentId,
  viewerShellRef,
}: {
  documentId: string;
  viewerShellRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { provides: selection } = useSelectionCapability();

  React.useEffect(() => {
    if (!selection) return;

    const copySelectedPdfText = (event: Event) => {
      if (isEditableCopyTarget(event.target)) return;
      if (hasDomSelectionOutside(viewerShellRef.current)) return;
      if (!selection.getState(documentId).selection) return;

      event.preventDefault();
      selection.copyToClipboard(documentId);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c") return;
      if (!event.metaKey && !event.ctrlKey) return;

      copySelectedPdfText(event);
    };

    document.addEventListener("copy", copySelectedPdfText);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("copy", copySelectedPdfText);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [documentId, selection, viewerShellRef]);

  return null;
}

function PDFViewerSelectionReleaseGuard({
  documentId,
}: {
  documentId: string;
}) {
  const { plugin: selectionPlugin } = useSelectionPlugin();
  const { provides: selection } = useSelectionCapability();
  const lastSelectionModeIdRef = React.useRef<null | string>(null);

  React.useEffect(() => {
    if (!selection) return;

    return selection.forDocument(documentId).onBeginSelection(({ modeId }) => {
      lastSelectionModeIdRef.current = modeId;
    });
  }, [documentId, selection]);

  React.useEffect(() => {
    if (!selection) return;

    let cleanupFrame = 0;
    const finalizeIfStillSelecting = () => {
      window.cancelAnimationFrame(cleanupFrame);
      cleanupFrame = window.requestAnimationFrame(() => {
        const selectionState = selection.getState(documentId);

        if (!selectionState.selecting) return;

        if (selectionState.selection && selectionPlugin) {
          const pluginWithEndSelection = selectionPlugin as unknown as {
            endSelection?: (documentId: string, modeId: string) => void;
          };

          pluginWithEndSelection.endSelection?.(
            documentId,
            lastSelectionModeIdRef.current ?? "pointerMode",
          );
          return;
        }

        if (!selectionState.selection) {
          selection.clear(documentId);
        }
      });
    };

    window.addEventListener("pointerup", finalizeIfStillSelecting);
    window.addEventListener("pointercancel", finalizeIfStillSelecting);
    window.addEventListener("blur", finalizeIfStillSelecting);

    return () => {
      window.cancelAnimationFrame(cleanupFrame);
      window.removeEventListener("pointerup", finalizeIfStillSelecting);
      window.removeEventListener("pointercancel", finalizeIfStillSelecting);
      window.removeEventListener("blur", finalizeIfStillSelecting);
    };
  }, [documentId, selection, selectionPlugin]);

  return null;
}

function PDFViewerTextSelectionLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { plugin: selectionPlugin } = useSelectionPlugin();
  const [rects, setRects] = React.useState<Rect[]>([]);

  React.useEffect(() => {
    if (!selectionPlugin) return;

    return selectionPlugin.registerSelectionOnPage({
      documentId,
      onRectsChange: ({ rects: nextRects }) => {
        setRects(nextRects);
      },
      pageIndex,
    });
  }, [documentId, pageIndex, selectionPlugin]);

  if (rects.length === 0) return null;

  return (
    <>
      {rects.map((rect, index) => (
        <div
          className="pointer-events-none absolute"
          key={`${index}-${rect.origin.x}-${rect.origin.y}`}
          style={{
            background: TEXT_SELECTION_BACKGROUND,
            height: rect.size.height * scale,
            left: rect.origin.x * scale,
            top: rect.origin.y * scale,
            width: rect.size.width * scale,
          }}
        />
      ))}
    </>
  );
}

function PDFViewerThumbnails({
  activePage,
  basePageRotations,
  documentId,
  onSelectPage,
  pageCount,
  pageRotationDeltas,
  pdfDocument,
  selectedPageIndexes,
}: {
  activePage: number;
  basePageRotations: Rotation[];
  documentId: string;
  onSelectPage: (pageNumber: number, mode: ThumbnailSelectionMode) => void;
  pageCount: number;
  pageRotationDeltas: PageRotationDeltas;
  pdfDocument: null | PdfDocumentObject;
  selectedPageIndexes: Set<number>;
}) {
  const thumbnailListboxId = React.useId();
  const activeDescendantId =
    activePage > 0 ? `${thumbnailListboxId}-page-${activePage}` : undefined;

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (pageCount < 1) return;

      const currentPage = activePage > 0 ? activePage : 1;
      let nextPage: null | number = null;

      switch (event.key) {
        case " ": {
          event.preventDefault();
          onSelectPage(currentPage, "toggle");
          return;
        }
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
      onSelectPage(nextPage, event.shiftKey ? "range" : "replace");
    },
    [activePage, onSelectPage, pageCount],
  );

  return (
    <PDFViewerThumbnailScrollArea
      activeDescendantId={activeDescendantId}
      basePageRotations={basePageRotations}
      documentId={documentId}
      onKeyDown={handleKeyDown}
      pageRotationDeltas={pageRotationDeltas}
      pdfDocument={pdfDocument}
    >
      {(meta: ThumbMeta) => {
        const pageNumber = meta.pageIndex + 1;
        const isActive = pageNumber === activePage;
        const isSelected = selectedPageIndexes.has(meta.pageIndex);
        const imagePadding = meta.padding ?? 0;
        const pageRotationDelta = pageRotationDeltas.get(meta.pageIndex) ?? 0;
        const thumbnailImageStyle: React.CSSProperties =
          pageRotationDelta % 2 === 1
            ? {
                height: meta.width,
                transform: `rotate(${rotationToDegrees(pageRotationDelta)}deg)`,
                width: meta.height,
              }
            : {
                height: meta.height,
                transform:
                  pageRotationDelta === 0
                    ? undefined
                    : `rotate(${rotationToDegrees(pageRotationDelta)}deg)`,
                width: meta.width,
              };

        return (
          <div
            className={cn(
              "absolute right-0 left-0 flex justify-center",
              isActive && "z-10",
            )}
            data-pdf-viewer-thumbnail={pageNumber}
            key={meta.pageIndex}
            style={{ height: meta.wrapperHeight, top: meta.top }}
          >
            <div
              aria-current={isActive ? "page" : undefined}
              aria-label={`Page ${pageNumber}`}
              aria-posinset={pageNumber}
              aria-selected={isSelected}
              aria-setsize={pageCount}
              className={cn(
                "flex h-full w-full cursor-default flex-col items-center justify-between rounded-md px-2 py-0 text-xs transition-shadow outline-none select-none hover:bg-sidebar-accent",
                isActive || isSelected
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground",
                isActive && THUMBNAIL_FOCUS_RING_CLASS,
              )}
              data-pdf-viewer-thumbnail-option={pageNumber}
              data-selected={isSelected ? "" : undefined}
              id={`${thumbnailListboxId}-page-${pageNumber}`}
              onClick={(event) => {
                const mode = event.shiftKey
                  ? "range"
                  : event.metaKey || event.ctrlKey
                    ? "toggle"
                    : "replace";

                onSelectPage(pageNumber, mode);
              }}
              role="option"
            >
              <span
                className="mt-0 flex items-center justify-center overflow-hidden rounded-md bg-transparent"
                style={{
                  height: meta.height + imagePadding * 2,
                  padding: imagePadding,
                  width: meta.width + imagePadding * 2,
                }}
              >
                <ThumbImg
                  className="block rounded-sm object-contain"
                  documentId={documentId}
                  meta={meta}
                  style={thumbnailImageStyle}
                />
              </span>
              <span
                className="flex items-center justify-center tabular-nums"
                style={{ height: meta.labelHeight }}
              >
                <span className="flex min-w-5 items-center justify-center px-1.5 text-center leading-5">
                  {pageNumber}
                </span>
              </span>
            </div>
          </div>
        );
      }}
    </PDFViewerThumbnailScrollArea>
  );
}

function PDFViewerThumbnailScrollArea({
  activeDescendantId,
  basePageRotations,
  children,
  documentId,
  onKeyDown,
  pageRotationDeltas,
  pdfDocument,
}: {
  activeDescendantId?: string;
  basePageRotations: Rotation[];
  children: (meta: ThumbMeta) => React.ReactNode;
  documentId: string;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  pageRotationDeltas: PageRotationDeltas;
  pdfDocument: null | PdfDocumentObject;
}) {
  const { plugin: thumbnailPlugin } = useThumbnailPlugin();
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportMetrics, setViewportMetrics] = React.useState({
    clientHeight: 0,
    scrollTop: 0,
  });
  const thumbnailScope = React.useMemo(
    () => thumbnailPlugin?.provides().forDocument(documentId) ?? null,
    [documentId, thumbnailPlugin],
  );

  const windowState = React.useSyncExternalStore(
    React.useCallback(
      (onStoreChange) => {
        if (!thumbnailScope) return () => {};

        return thumbnailScope.onWindow(() => onStoreChange());
      },
      [thumbnailScope],
    ),
    React.useCallback(
      () => thumbnailScope?.getWindow() ?? null,
      [thumbnailScope],
    ),
    () => null,
  );
  const hasWindowState = Boolean(windowState);
  const paddingY = thumbnailPlugin?.cfg.paddingY ?? 0;
  const thumbnailLayout = React.useMemo(
    () =>
      buildThumbnailLayout({
        basePageRotations,
        gap: thumbnailPlugin?.cfg.gap ?? THUMBNAIL_GAP,
        imagePadding: thumbnailPlugin?.cfg.imagePadding ?? 0,
        labelHeight: thumbnailPlugin?.cfg.labelHeight ?? THUMBNAIL_LABEL_HEIGHT,
        paddingY,
        pageRotationDeltas,
        pdfDocument,
        width: thumbnailPlugin?.cfg.width ?? THUMBNAIL_WIDTH,
      }),
    [
      basePageRotations,
      pageRotationDeltas,
      pdfDocument,
      paddingY,
      thumbnailPlugin,
    ],
  );
  const effectiveWindowState = React.useMemo(() => {
    if (!thumbnailLayout) return windowState;

    const items = getVisibleThumbnailItems({
      buffer: thumbnailPlugin?.cfg.buffer ?? 3,
      clientHeight: viewportMetrics.clientHeight,
      items: thumbnailLayout.items,
      scrollTop: viewportMetrics.scrollTop,
    });

    return {
      end: items.at(-1)?.pageIndex ?? -1,
      items,
      start: items[0]?.pageIndex ?? -1,
      totalHeight: thumbnailLayout.totalHeight,
    };
  }, [thumbnailLayout, thumbnailPlugin, viewportMetrics, windowState]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !thumbnailScope) return;

    const updateWindow = () => {
      setViewportMetrics({
        clientHeight: viewport.clientHeight,
        scrollTop: viewport.scrollTop,
      });
      thumbnailScope.updateWindow(viewport.scrollTop, viewport.clientHeight);
    };

    viewport.addEventListener("scroll", updateWindow);
    const frame = window.requestAnimationFrame(updateWindow);

    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", updateWindow);
    };
  }, [thumbnailScope]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !thumbnailScope) return;

    const resizeObserver = new ResizeObserver(() => {
      setViewportMetrics({
        clientHeight: viewport.clientHeight,
        scrollTop: viewport.scrollTop,
      });
      thumbnailScope.updateWindow(viewport.scrollTop, viewport.clientHeight);
    });

    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, [thumbnailScope]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !thumbnailScope) return;

    thumbnailScope.updateWindow(viewport.scrollTop, viewport.clientHeight);
  }, [thumbnailLayout, thumbnailScope, windowState]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !thumbnailScope || !hasWindowState) return;

    return thumbnailScope.onScrollTo(({ behavior, top }) => {
      viewport.scrollTo({ behavior, top });
    });
  }, [hasWindowState, thumbnailScope]);

  return (
    <ScrollArea
      className="h-full w-full"
      orientation="vertical"
      scrollFade
      viewportClassName="group/pdf-thumbnail-sidebar px-4 focus-visible:ring-0 focus-visible:ring-offset-0"
      viewportProps={{
        "aria-activedescendant": activeDescendantId,
        "aria-label": "PDF pages",
        "aria-multiselectable": true,
        onKeyDown,
        onMouseDown: (event) => {
          event.currentTarget.focus({ preventScroll: true });
        },
        role: "listbox",
        style: {
          paddingBottom: paddingY,
          paddingTop: paddingY,
        },
        tabIndex: 0,
      }}
      viewportRef={viewportRef}
    >
      <div
        className="relative"
        style={{ height: effectiveWindowState?.totalHeight ?? 0 }}
      >
        {effectiveWindowState?.items.map((meta) => children(meta))}
      </div>
    </ScrollArea>
  );
}

// Captures the scrollable viewport element so the imperative handle can expose
// it.
function PDFViewerViewportBridge({
  viewportElementRef,
}: {
  viewportElementRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const elementRef = useViewportElement();

  React.useEffect(() => {
    viewportElementRef.current = elementRef?.current ?? null;
  });

  return null;
}

function rotationToDegrees(rotation: Rotation) {
  return (rotation as number) * 90;
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

function useSharedPdfEngine() {
  const [engine, setEngine] = React.useState<null | PdfEngine>(null);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    loadSharedPdfEngine().then(
      (loadedEngine) => {
        if (!cancelled) setEngine(loadedEngine);
      },
      (loadError: Error) => {
        if (!cancelled) setError(loadError);
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return { engine, error };
}

export const PDFViewer = React.forwardRef<PDFViewerHandle, PDFViewerProps>(
  function PDFViewer(
    {
      className,
      defaultZoom = DEFAULT_ZOOM,
      fileName,
      onActivePageChange,
      onDocumentLoadSuccess,
      onPagePointerCancel,
      onPagePointerDown,
      onPagePointerMove,
      onPagePointerUp,
      onPdfUpload,
      pageClassName,
      renderPageOverlay,
      showDownload = true,
      showRotateControls = true,
      showToolbar = true,
      showUpload = true,
      src,
      toolbarActions,
    },
    ref,
  ) {
    const { engine, error: engineError } = useSharedPdfEngine();
    const [uploadedPdfFile, setUploadedPdfFile] = React.useState<{
      src: string | undefined;
      url: null | string;
    }>(() => ({ src, url: null }));
    const uploadedPdfUrl =
      uploadedPdfFile.src === src ? uploadedPdfFile.url : null;
    const pdfFile = uploadedPdfUrl ?? src ?? "";

    React.useEffect(
      () => () => {
        if (uploadedPdfUrl) URL.revokeObjectURL(uploadedPdfUrl);
      },
      [uploadedPdfUrl],
    );

    const handleUploadFile = React.useCallback(
      (nextFile: File) => {
        const nextUrl = URL.createObjectURL(nextFile);

        setUploadedPdfFile({ src, url: nextUrl });
      },
      [src],
    );

    // Plugin registrations are created once per viewer instance.
    const [plugins] = React.useState(() => [
      createPluginRegistration(DocumentManagerPluginPackage),
      createPluginRegistration(ViewportPluginPackage, {
        viewportGap: PAGE_GAP,
      }),
      createPluginRegistration(ScrollPluginPackage, {
        defaultBufferSize: 2,
        defaultPageGap: PAGE_GAP,
      }),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(TilingPluginPackage, {
        extraRings: 0,
        overlapPx: 2.5,
        tileSize: 768,
      }),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage, {
        marquee: { enabled: false },
      }),
      createPluginRegistration(SearchPluginPackage, {
        showAllResults: true,
      }),
      createPluginRegistration(ThumbnailPluginPackage, {
        autoScroll: true,
        buffer: 3,
        gap: THUMBNAIL_GAP,
        imagePadding: THUMBNAIL_IMAGE_PADDING,
        labelHeight: THUMBNAIL_LABEL_HEIGHT,
        paddingY: THUMBNAIL_PANE_PADDING_Y,
        scrollBehavior: "auto",
        width: THUMBNAIL_WIDTH,
      }),
      createPluginRegistration(ZoomPluginPackage, {
        defaultZoomLevel: defaultZoom,
        maxZoom: MAX_ZOOM,
        minZoom: MIN_ZOOM,
      }),
      createPluginRegistration(RotatePluginPackage),
    ]);

    if (engineError) {
      return (
        <div
          className={cn(
            "grid h-full w-full place-items-center bg-background p-6 text-sm text-muted-foreground",
            className,
          )}
          data-slot="pdf-viewer"
        >
          Unable to load the PDF engine.
        </div>
      );
    }

    if (!engine) {
      return (
        <div
          className={cn(
            "relative flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden bg-background",
            className,
          )}
          data-slot="pdf-viewer"
        >
          {showToolbar ? (
            <div className="min-h-12 border-b bg-background" />
          ) : null}
          <div className="relative min-h-0 flex-1">
            <PDFViewerLoadingSkeleton sidebarInline sidebarOpen={false} />
          </div>
        </div>
      );
    }

    return (
      <EmbedPDF engine={engine} plugins={plugins}>
        <PDFViewerDocumentLoader
          className={className}
          defaultZoom={defaultZoom}
          fileName={fileName}
          onActivePageChange={onActivePageChange}
          onDocumentLoadSuccess={onDocumentLoadSuccess}
          onPagePointerCancel={onPagePointerCancel}
          onPagePointerDown={onPagePointerDown}
          onPagePointerMove={onPagePointerMove}
          onPagePointerUp={onPagePointerUp}
          onPdfUpload={onPdfUpload}
          onUploadFile={handleUploadFile}
          pageClassName={pageClassName}
          pdfFile={pdfFile}
          renderPageOverlay={renderPageOverlay}
          showDownload={showDownload}
          showRotateControls={showRotateControls}
          showToolbar={showToolbar}
          showUpload={showUpload}
          toolbarActions={toolbarActions}
          viewerRef={ref}
        />
      </EmbedPDF>
    );
  },
);
