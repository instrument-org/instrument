import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import {
  IMAGE_PANZOOM_VIEWPORT_CLASS,
  useImagePanzoom,
} from "@/client/hooks/use-image-panzoom";
import { ArrowsInIcon } from "@phosphor-icons/react/ArrowsIn";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/MagnifyingGlassPlus";
import { useRef, useState } from "react";

import { ImageWithFallback } from "./image-with-fallback";
import { Button } from "./ui/button";

/**
 * A single image, fitted to the space it is given, with wheel and pinch zoom.
 *
 * `onError` reports upward rather than being handled here because the failure
 * outlives this component: the host swaps the whole viewer for the
 * preview-unavailable card and drops the header's Copy action.
 */
export function ImageViewer({
  file,
  onError,
}: {
  // Only the name and the bytes are certain: this also draws images a markdown
  // embed pointed at by URL, which name no file anyone could be handed.
  file: Partial<Pick<TaskFileViewerFile, "filePath" | "taskId">> &
    Pick<TaskFileViewerFile, "filename" | "url">;
  onError: () => void;
}) {
  const { filename, filePath, taskId, url } = file;
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const { canReset, reset, zoomIn, zoomOut } = useImagePanzoom({
    contentRef,
    viewportRef,
  });
  // Always on: which of the two gestures a press means is settled by the
  // panzoom hook, which stops cancelling the press once the image is zoomed all
  // the way out, and nowhere else. Setting it from the zoom level here as well
  // would be the same decision made twice, in two places that can disagree.
  const dragProps = useFileDrag(
    filePath && taskId ? { filePath, taskId } : undefined,
  );

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
            onLoad={() => {
              setIsLoaded(true);
            }}
            showCheckerboard
            src={url}
            {...dragProps}
          />
        </div>
      </div>
      {/* Held back until there is an image to zoom. A file the app cannot
          preview only reports that once its load has actually failed, which
          takes a round trip to the main process, and controls drawn over the
          empty frame in the meantime appear and then vanish as the
          preview-unavailable card replaces them. Remounted per file by the
          host's `key`, so this starts false again for the next one. */}
      {isLoaded && (
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
      )}
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
    <div className="flex items-center gap-1 rounded-xl bg-background p-1 text-foreground shadow-lg">
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
