import { type ViewerFile } from "@/client/atoms/viewer-file";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import {
  IMAGE_PANZOOM_VIEWPORT_CLASS,
  useImagePanzoom,
} from "@/client/hooks/use-image-panzoom";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { setPictureKeys } from "@/client/lib/picture-keys";
import { cn } from "@/client/lib/utils";
import { WINDOW_MENU_SHORTCUTS } from "@/shared/window-shortcuts";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/MagnifyingGlassPlus";
import { type RefObject, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ImageWithFallback } from "./image-with-fallback";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/**
 * A single image, fitted to the space it is given on a ground of its own, with
 * pinch and Cmd+wheel zoom and a two-finger scroll that moves around it. A
 * click on a picture larger than its pane zooms in there, and a click while
 * zoomed fits it again. A press gives it the keyboard, where the window's zoom
 * chords zoom it and the arrows move around it.
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
  // panzoom hook, which leaves the press alone once the image has nowhere to
  // move, and nowhere else. Setting it from the zoom level here as well
  // would be the same decision made twice, in two places that can disagree.
  const dragProps = useFileDrag(hostPath ? { hostPath } : undefined);

  return (
    <div
      className={`${IMAGE_PANZOOM_VIEWPORT_CLASS} relative size-full bg-foreground/6`}
    >
      <div
        className={cn(
          "flex size-full touch-none items-center justify-center overflow-hidden p-6 -outline-offset-3 outline-none focus-visible:outline-[3px] focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
          // A browser's own image view: grab to move around a zoomed
          // picture, and where there is nothing to move, a click's way out.
          zoom.isZoomed &&
            (zoom.canPan
              ? "cursor-grab active:cursor-grabbing"
              : "cursor-zoom-out"),
        )}
        // After the file list: the picture has the keyboard when the folder
        // beside it is put away.
        data-keyboard-home="2"
        data-picture-keys
        ref={viewportRef}
        tabIndex={0}
      >
        <div
          className="flex items-center justify-center"
          ref={contentRef}
          style={{ height: "100%", width: "100%" }}
        >
          <ImageWithFallback
            alt={filename}
            className={cn(
              "size-auto max-h-full max-w-full object-contain shadow-sm ring-1 ring-foreground/10 select-none",
              zoom.clickZoomsIn && "cursor-zoom-in",
            )}
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
        createPortal(
          <ImageZoomMenu {...zoom} viewportRef={viewportRef} />,
          controlsInto,
        )}
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
  viewportRef,
  zoomOut,
}: ReturnType<typeof useImagePanzoom> & {
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const isFit = !isZoomed;
  // Rounded before it is compared, so a size that reads 100% is checked as it.
  const percent = actualScale ? Math.round((scale / actualScale) * 100) : null;
  const label = isFit || percent === null ? "Fit" : `${percent}%`;
  // With the menu open the zoom chords still mean this picture. Its arrows are
  // the menu's, so Quick Look does not take them for walking the folder.
  const answerChords = (menu: HTMLDivElement) =>
    setPictureKeys(menu, {
      canPan: () => true,
      pan: () => undefined,
      zoom: (chord) => {
        if (chord === "zoomIn") {
          zoomIn();
        } else if (chord === "zoomOut") {
          zoomOut();
        } else {
          fit();
        }
      },
    });
  return (
    // Non-modal, so the picture stays in reach while it is open.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* The row's own button, as Source beside it is. As wide as its
            reading, which changes a digit at a time in tabular figures. */}
        <Button
          aria-label={`Zoom: ${label}`}
          className="shrink-0 gap-1 px-1.5 text-xs text-muted-foreground tabular-nums has-[>svg]:px-1.5 data-[state=open]:bg-foreground/7 data-[state=open]:text-accent-foreground dark:data-[state=open]:bg-accent/50"
          size="sm"
          variant="ghost"
        >
          <MagnifyingGlassIcon className="size-3.5" />
          {label}
          <CaretDownIcon className="size-2.5 opacity-60" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        data-picture-keys
        // The picture, not the trigger, is where the keyboard goes after a pick.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          viewportRef.current?.focus({ preventScroll: true });
        }}
        ref={answerChords}
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
          <DropdownMenuShortcut>
            {formatAcceleratorText(WINDOW_MENU_SHORTCUTS.zoomIn.accelerator)}
          </DropdownMenuShortcut>
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
          <DropdownMenuShortcut>
            {formatAcceleratorText(WINDOW_MENU_SHORTCUTS.zoomOut.accelerator)}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={isFit} onSelect={fit}>
          Fit
          <DropdownMenuShortcut>
            {formatAcceleratorText(
              WINDOW_MENU_SHORTCUTS.actualSize.accelerator,
            )}
          </DropdownMenuShortcut>
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
