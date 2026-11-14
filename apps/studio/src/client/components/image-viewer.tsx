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
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
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

const PICTURE_CLASS =
  "size-auto max-h-full max-w-full object-contain shadow-sm ring-1 ring-foreground/10 select-none";

/**
 * The picture the last viewer to show one drew, while it may still be on
 * screen. A step from one file to the next mounts the next viewer in the
 * commit that takes the last one down, so once that task is over without a
 * viewer taking its place, the picture is gone and nothing holds it.
 */
class DrawnPicture {
  /** Whether the viewer that drew it is still up. */
  isMounted = true;
  private letGo: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly src: string) {}

  /** A viewer took its place and keeps it on screen until its own is ready. */
  keep() {
    clearTimeout(this.letGo);
    this.letGo = undefined;
  }

  /** A viewer showing `src`, or holding this picture, went. */
  release(src: string) {
    if (src === this.src) {
      this.isMounted = false;
    }
    if (!this.isMounted && this.letGo === undefined) {
      this.letGo = setTimeout(() => {
        if (drawnPicture === this) {
          drawnPicture = null;
        }
      });
    }
  }
}

let drawnPicture: DrawnPicture | null = null;

/** The picture a viewer mounting for `src` keeps on screen until its own is decoded. */
function heldPictureFor(src: string): null | string {
  return drawnPicture !== null && drawnPicture.src !== src
    ? drawnPicture.src
    : null;
}

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
  const src = previewUrl ?? url;
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Stepping from one picture to the next mounts a new viewer, and the
  // picture it took the place of stays drawn until this one's is decoded,
  // so the step is one frame from picture to picture with no ground between.
  const [held, setHeld] = useState(() => heldPictureFor(src));
  const [handoff] = useState(() => drawnPicture);
  useLayoutEffect(() => {
    // Gone before this commit, or its viewer still up after it: not a step
    // but a viewer opened elsewhere (Quick Look over the folder's).
    if (handoff !== drawnPicture || handoff?.isMounted) {
      // oxlint-disable-next-line react/set-state-in-effect -- whether the last viewer went in this commit is known only once it is committed, and before the frame is painted
      setHeld(null);
      return;
    }
    handoff?.keep();
  }, [handoff]);
  useLayoutEffect(() => () => drawnPicture?.release(src), [src]);
  const showPicture = () => {
    setHeld(null);
    drawnPicture = new DrawnPicture(src);
  };
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
              PICTURE_CLASS,
              zoom.clickZoomsIn && "cursor-zoom-in",
              held !== null && "invisible",
            )}
            // Taking a picture's place it is shown once decoded, so the frame
            // it appears in draws it whole.
            {...(held === null ? {} : { decoding: "sync" as const })}
            enters={held === null}
            filename={filename}
            onError={onError}
            onLoad={(event) => {
              setIsLoaded(true);
              if (held === null) {
                showPicture();
                return;
              }
              event.currentTarget.decode().then(showPicture, showPicture);
            }}
            showCheckerboard
            src={src}
            {...dragProps}
          />
        </div>
      </div>
      {held !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
        >
          <img
            alt=""
            className={cn(PICTURE_CLASS, "checkerboard")}
            decoding="sync"
            src={held}
          />
        </div>
      )}
      {/* Held back until there is an image to zoom, or one is on its way in
          place of the picture before it. A file the app cannot preview only
          reports that once its load has actually failed, which takes a round
          trip to the main process, and a control in the row in the meantime
          would appear and then vanish as the preview-unavailable card
          replaces the viewer. Remounted per file by the host's `key`, so
          this starts false again for the next one. */}
      {(isLoaded || held !== null) &&
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
