import { type ViewerFile } from "@/client/atoms/viewer-file";
import { formatByteSize } from "@/client/components/extend/file-system";
import { ShortcutKeys } from "@/client/components/shortcut-keys";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import {
  IMAGE_PANZOOM_VIEWPORT_CLASS,
  useImagePanzoom,
} from "@/client/hooks/use-image-panzoom";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import {
  formatOfBytes,
  formatOfName,
  IMAGE_SIGNATURE_LENGTH,
} from "@/client/lib/image-format";
import { setPictureKeys } from "@/client/lib/picture-keys";
import { cn } from "@/client/lib/utils";
import { type ShortcutAccelerator } from "@/shared/shortcuts";
import { WINDOW_MENU_SHORTCUTS } from "@/shared/window-shortcuts";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/MagnifyingGlassPlus";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
 * Nothing is drawn over the picture: a bar under it says how large it is and
 * holds its zoom.
 *
 * `onError` reports upward rather than being handled here because the failure
 * outlives this component: the host swaps the whole viewer for the
 * preview-unavailable card and drops the header's Copy action.
 */
export function ImageViewer({
  file,
  onError,
  previewUrl,
}: {
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
  const [pixels, setPixels] = useState<null | {
    height: number;
    width: number;
  }>(null);
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
      className={`${IMAGE_PANZOOM_VIEWPORT_CLASS} flex size-full flex-col bg-foreground/6`}
    >
      <div className="relative min-h-0 flex-1">
        <div
          className={cn(
            // No focus ring, as in Preview: the picture filling the pane is
            // where the keyboard is, and a ring inside the pane's rounded
            // corners would be clipped by them.
            "flex size-full touch-none items-center justify-center overflow-hidden p-6 outline-none",
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
                setPixels({
                  height: event.currentTarget.naturalHeight,
                  width: event.currentTarget.naturalWidth,
                });
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
      </div>
      {/* Laid out from the start, so the picture fits the room it keeps; its
          readings wait for a picture to read. A file the app cannot preview
          only reports that once its load has actually failed, and controls
          in the meantime would appear and then vanish as the
          preview-unavailable card replaces the viewer. Remounted per file by
          the host's `key`, so this starts empty again for the next one. */}
      <ImageBar
        {...zoom}
        file={file}
        // A rendered preview's pixels are the preview's, not the file's.
        pixels={previewUrl === undefined ? pixels : null}
        ready={isLoaded || held !== null}
        viewportRef={viewportRef}
      />
    </div>
  );
}

/** Zoom levels the menu jumps to, as a share of the picture's actual size. */
const ZOOM_LEVELS = [0.5, 1, 2, 4];
// The slider's steps between Fit and the furthest in, on a log scale so a
// drag zooms evenly however far in it is.
const SLIDER_STEPS = 1000;

/**
 * The bar under the picture: how large the file is on the left, and on the
 * right its zoom as a slider between Zoom out and Zoom in, then how far in it
 * is, opening a menu of set levels. Every way of zooming moves the same
 * slider, so any one of them shows the others.
 */
function ImageBar({
  actualScale,
  actualSize,
  file: { filename, hostPath, url },
  fit,
  isZoomed,
  maxScale,
  pixels,
  ready,
  scale,
  viewportRef,
  zoomIn,
  zoomOut,
  zoomTo,
}: ReturnType<typeof useImagePanzoom> & {
  file: Partial<Pick<ViewerFile, "hostPath">> &
    Pick<ViewerFile, "filename" | "url">;
  pixels: null | { height: number; width: number };
  ready: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const facts = useImageFileFacts(hostPath === undefined ? undefined : url);
  const isFit = !isZoomed;
  // Rounded before it is compared, so a size that reads 100% is checked as it.
  const percent = actualScale ? Math.round((scale / actualScale) * 100) : null;
  const reach = Math.log(maxScale);
  const sliderValue =
    reach > 0 ? Math.round((Math.log(scale) / reach) * SLIDER_STEPS) : 0;
  const named = formatOfName(filename);
  const size = [
    pixels && `${pixels.width} × ${pixels.height}`,
    facts?.bytes !== undefined && formatByteSize(facts.bytes),
    // Said only where the bytes and the name disagree; otherwise the name says it.
    facts?.format !== undefined &&
      named !== undefined &&
      facts.format !== named &&
      `${facts.format} image`,
  ].filter(Boolean);
  // With the bar holding the keyboard the zoom chords still mean this picture.
  // Its arrows are the slider's, so Quick Look does not take them for walking
  // the folder.
  const answerChords = (element: HTMLDivElement) =>
    setPictureKeys(element, {
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
    <div
      className="flex h-10 shrink-0 items-center gap-2 border-t border-border/60 bg-background px-3"
      data-picture-keys
      ref={answerChords}
    >
      <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
        {ready ? size.join(" · ") : null}
      </span>
      {ready && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ZoomStepButton
            accelerator={WINDOW_MENU_SHORTCUTS.zoomOut.accelerator}
            disabled={isFit}
            label="Zoom out"
            onClick={zoomOut}
          >
            <MagnifyingGlassMinusIcon className="size-4" />
          </ZoomStepButton>
          <SliderPrimitive.Root
            className="relative mx-1 flex h-5 w-32 touch-none items-center select-none"
            max={SLIDER_STEPS}
            min={0}
            onValueChange={([value = 0]) => {
              zoomTo(Math.exp((value / SLIDER_STEPS) * reach), true);
            }}
            step={1}
            value={[sliderValue]}
          >
            <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-foreground/12">
              <SliderPrimitive.Range className="absolute h-full bg-foreground/45" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              aria-label="Zoom"
              className="block size-3.5 rounded-full bg-background shadow-sm ring-1 ring-foreground/20 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </SliderPrimitive.Root>
          <ZoomStepButton
            accelerator={WINDOW_MENU_SHORTCUTS.zoomIn.accelerator}
            disabled={scale >= maxScale}
            label="Zoom in"
            onClick={zoomIn}
          >
            <MagnifyingGlassPlusIcon className="size-4" />
          </ZoomStepButton>
          <ZoomMenu
            actualScale={actualScale}
            actualSize={actualSize}
            fit={fit}
            isFit={isFit}
            maxScale={maxScale}
            percent={percent}
            viewportRef={viewportRef}
            zoomIn={zoomIn}
            zoomOut={zoomOut}
            zoomTo={zoomTo}
          />
        </div>
      )}
    </div>
  );
}

/** One end of the slider, a step in or out, naming its shortcut on hover. */
function ZoomStepButton({
  accelerator,
  children,
  disabled,
  label,
  onClick,
}: {
  accelerator: ShortcutAccelerator;
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="size-7 text-muted-foreground"
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2" side="top">
        {label}
        <ShortcutKeys accelerator={accelerator} />
      </TooltipContent>
    </Tooltip>
  );
}

/** How far in the picture is, opening the set levels and the steps. */
function ZoomMenu({
  actualScale,
  actualSize,
  fit,
  isFit,
  maxScale,
  percent,
  viewportRef,
  zoomIn,
  zoomOut,
  zoomTo,
}: {
  actualScale: null | number;
  actualSize: () => void;
  fit: () => void;
  isFit: boolean;
  maxScale: number;
  percent: null | number;
  viewportRef: RefObject<HTMLDivElement | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (scale: number) => void;
}) {
  return (
    // Non-modal, so the picture stays in reach while it is open.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* As wide as its reading, which changes a digit at a time in
            tabular figures. */}
        <Button
          aria-label={
            isFit || percent === null ? "Zoom: Fit" : `Zoom: ${percent}%`
          }
          className="ml-1 min-w-14 shrink-0 gap-0.5 px-1.5 text-xs tabular-nums has-[>svg]:px-1.5 data-[state=open]:bg-foreground/7 dark:data-[state=open]:bg-accent/50"
          size="sm"
          variant="ghost"
        >
          {percent === null ? "Fit" : `${percent}%`}
          <CaretDownIcon className="size-2.5 opacity-60" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        data-picture-keys
        // The picture, not the trigger, is where the keyboard goes after a pick.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          viewportRef.current?.focus({ preventScroll: true });
        }}
        side="top"
      >
        <DropdownMenuCheckboxItem checked={isFit} onSelect={fit}>
          Fit
          <DropdownMenuShortcut>
            {formatAcceleratorText(
              WINDOW_MENU_SHORTCUTS.actualSize.accelerator,
            )}
          </DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        {ZOOM_LEVELS.map((level) => {
          const target = actualScale === null ? null : actualScale * level;
          return (
            <DropdownMenuCheckboxItem
              checked={!isFit && percent === level * 100}
              // Only the levels between Fit and the furthest in.
              disabled={target === null || target <= 1 || target > maxScale}
              key={level}
              onSelect={() => {
                if (level === 1) {
                  actualSize();
                } else if (target !== null) {
                  zoomTo(target);
                }
              }}
            >
              {level === 1 ? "Actual size" : `${level * 100}%`}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The file's size in bytes and the format its first bytes name, from one
 * read of its opening bytes: the file channel answers a range with the whole
 * length in `Content-Range`. Skipped for a picture with no file behind it.
 */
function useImageFileFacts(url: string | undefined) {
  const query = useQuery({
    queryFn:
      url === undefined
        ? skipToken
        : async ({ signal }) => {
            const response = await fetch(url, {
              headers: { Range: `bytes=0-${IMAGE_SIGNATURE_LENGTH - 1}` },
              signal,
            });
            if (!response.ok) {
              return null;
            }
            const total = response.headers
              .get("Content-Range")
              ?.match(/\/(\d+)$/)?.[1];
            const length = response.headers.get("Content-Length");
            // A channel that ignores the range sends the whole file; the first
            // chunk is enough, and the rest is never read.
            const reader = response.body?.getReader();
            const first = reader ? await reader.read() : undefined;
            await reader?.cancel();
            const head = first?.value?.subarray(0, IMAGE_SIGNATURE_LENGTH);
            const bytes =
              total === undefined
                ? response.status === 200 && length !== null
                  ? Number(length)
                  : undefined
                : Number(total);
            return {
              bytes,
              format: head === undefined ? undefined : formatOfBytes(head),
            };
          },
    queryKey: ["image-file-facts", url],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return query.data ?? undefined;
}
