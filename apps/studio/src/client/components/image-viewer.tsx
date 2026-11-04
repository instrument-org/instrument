import { type ViewerFile } from "@/client/atoms/viewer-file";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import {
  IMAGE_PANZOOM_VIEWPORT_CLASS,
  useImagePanzoom,
} from "@/client/hooks/use-image-panzoom";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/MagnifyingGlassPlus";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ImageWithFallback } from "./image-with-fallback";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/**
 * A single image, fitted to the space it is given on a ground of its own, with
 * pinch and Cmd+wheel zoom and a two-finger scroll that moves around it.
 *
 * Nothing is drawn over the picture: its zoom menu goes into `controlsInto`,
 * the row above it, which the host owns.
 *
 * `onError` reports upward rather than being handled here because the failure
 * outlives this component: the host swaps the whole viewer for the
 * preview-unavailable card and drops the header's Copy action.
 */
export function ImageViewer({
  controlsInto,
  file,
  onError,
  previewUrl,
}: {
  controlsInto: HTMLElement | null;
  // Only the name and the bytes are certain: this also draws images a markdown
  // embed pointed at by URL, which name no file anyone could be handed.
  file: Partial<Pick<ViewerFile, "hostPath">> &
    Pick<ViewerFile, "filename" | "url">;
  onError: () => void;
  /** A rendered preview when the original file is not browser-decodable. */
  previewUrl?: string;
}) {
  const { filename, hostPath, url } = file;
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const zoom = useImagePanzoom({ contentRef, viewportRef });
  // Always on: which of the two gestures a press means is settled by the
  // panzoom hook, which stops cancelling the press once the image is zoomed all
  // the way out, and nowhere else. Setting it from the zoom level here as well
  // would be the same decision made twice, in two places that can disagree.
  const dragProps = useFileDrag(hostPath ? { hostPath } : undefined);

  return (
    <div
      className={`${IMAGE_PANZOOM_VIEWPORT_CLASS} relative size-full bg-foreground/6`}
    >
      <div
        className="flex size-full items-center justify-center overflow-hidden p-6"
        ref={viewportRef}
      >
        <div
          className={cn(
            "flex items-center justify-center",
            zoom.isZoomed && "cursor-grab active:cursor-grabbing",
          )}
          ref={contentRef}
          style={{ height: "100%", width: "100%" }}
        >
          <ImageWithFallback
            alt={filename}
            className="size-auto max-h-full max-w-full object-contain shadow-sm ring-1 ring-foreground/10 select-none"
            filename={filename}
            onError={onError}
            onLoad={() => {
              setIsLoaded(true);
            }}
            showCheckerboard
            src={previewUrl ?? url}
            {...dragProps}
          />
        </div>
      </div>
      {/* Held back until there is an image to zoom. A file the app cannot
          preview only reports that once its load has actually failed, which
          takes a round trip to the main process, and a control in the row in
          the meantime would appear and then vanish as the preview-unavailable
          card replaces the viewer. Remounted per file by the host's `key`, so
          this starts false again for the next one. */}
      {isLoaded &&
        controlsInto &&
        createPortal(<ImageZoomMenu {...zoom} />, controlsInto)}
    </div>
  );
}

/**
 * The zoom, as one quiet word in the row: Fit, or how far in it is, opening a
 * menu of the rest. Styled as the page's mode menu beside it in other rows.
 */
function ImageZoomMenu({
  actualScale,
  actualSize,
  fit,
  isZoomed,
  scale,
  zoomIn,
  zoomOut,
}: ReturnType<typeof useImagePanzoom>) {
  const isFit = !isZoomed;
  // Rounded before it is compared, so a size that reads 100% is checked as it.
  const percent = actualScale ? Math.round((scale / actualScale) * 100) : null;
  const label = isFit || percent === null ? "Fit" : `${percent}%`;
  return (
    // Non-modal, so the picture stays in reach while it is open.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Zoom: ${label}`}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground/70 tabular-nums outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-[3px] focus-visible:outline-ring/50 focus-visible:[outline-style:solid] data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground"
          type="button"
        >
          <MagnifyingGlassIcon className="size-3.5" />
          <span>{label}</span>
          <CaretDownIcon className="size-2.5 opacity-60" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        // The picture, not the trigger, is where attention goes after a pick.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        {/* Left open on a press, since one step is rarely the whole way. */}
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            zoomIn();
          }}
        >
          <MagnifyingGlassPlusIcon className="size-4" />
          <span>Zoom in</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isFit}
          onSelect={(event) => {
            event.preventDefault();
            zoomOut();
          }}
        >
          <MagnifyingGlassMinusIcon className="size-4" />
          <span>Zoom out</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={isFit} onSelect={fit}>
          Fit
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={!isFit && percent === 100}
          // A picture smaller than the space it has is at its fit already.
          disabled={!actualScale || actualScale <= 1}
          onSelect={actualSize}
        >
          Actual size
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
