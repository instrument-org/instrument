import { openFilePreviewAtom } from "@/client/atoms/file-preview";
import { cn } from "@/client/lib/utils";
import {
  ArrowsInIcon,
  CodeIcon,
  GraphIcon,
  HandGrabbingIcon,
  HandIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from "@phosphor-icons/react";
import { useSetAtom } from "jotai";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { useDiagramPanzoom } from "../hooks/use-diagram-panzoom";
import { useNearViewport } from "../hooks/use-near-viewport";
import { renderMermaid, toDiagramImageUrl } from "../lib/mermaid";
import {
  blockToolbarButtonClassName,
  CodeBlock,
  CodeWithCopy,
} from "./code-block";
import { CopyButton } from "./copy-button";
import { useTheme } from "./theme-provider";

/** How long to wait before asking again for a diagram whose render threw, and
 * how many times. Spaced out and few: a fetch still failing after this is not
 * the transient blip the retry is for. */
const RETRY_DELAYS_MS = [1000, 5000];

/** How far the pointer may travel between press and release and still count as
 * a click on the diagram rather than the end of a pan. */
const CLICK_SLOP_PX = 4;

/**
 * A ```mermaid fence, rendered as a diagram once its source parses.
 *
 * Until then — and permanently, for source that never parses — this is the
 * highlighted code block a mermaid fence rendered as before diagrams existed.
 * That fallback is the whole error strategy: streaming markdown spends most of
 * its life half-written, so there is no moment at which a parse failure is
 * worth telling the reader about.
 */
export const MermaidDiagram = ({
  code,
  language,
}: {
  code: string;
  language: string;
}) => {
  const { resolvedTheme } = useTheme();
  const openFilePreview = useSetAtom(openFilePreviewAtom);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const panViewportRef = useRef<HTMLDivElement>(null);
  const panContentRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<null | { x: number; y: number }>(null);
  const [svg, setSvg] = useState<string>();
  const [showSource, setShowSource] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Same reason `CodeBlock` defers: the fence is rewritten on every token, and
  // a mermaid render is far too expensive to run at that rate.
  const deferredCode = useDeferredValue(code);
  // A message can carry many diagrams, and laying one out is main-thread work
  // measured in tens of milliseconds. Rendering the ones far below the fold on
  // mount spends all of it before the reader has scrolled to any of them.
  const { isNear, ref: viewportRef } = useNearViewport<HTMLDivElement>();
  const { isCapturing, isZoomed, reset, setCapturing, zoomIn, zoomOut } =
    useDiagramPanzoom({
      contentRef: panContentRef,
      enabled: Boolean(svg) && !showSource,
      rootRef: viewportRef,
      viewportRef: panViewportRef,
    });

  useEffect(() => {
    const source = deferredCode.trim();
    if (!source || !isNear) {
      return;
    }

    let isCancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    void renderMermaid({ code: source, theme: resolvedTheme })
      .then((rendered) => {
        // `undefined` means the source did not parse, which while a message
        // streams is simply "not finished yet". Holding the last good render
        // (or the source block, when there has not been one) is what keeps a
        // half-written graph from flashing between states.
        if (!isCancelled && rendered) {
          setSvg(rendered);
        }
      })
      .catch(() => {
        // Keep whatever is on screen, then ask again. A throw here is nearly
        // always the chunk fetch dropping, and while `loadMermaid` will refetch
        // for the next caller, a diagram in a finished message never becomes
        // one: its source, theme and visibility have all settled, so nothing
        // would re-run this effect. Without a retry of its own, this one fence
        // stays a code block for the rest of the session while every diagram
        // that mounts later recovers.
        const delay = RETRY_DELAYS_MS[attempt];
        if (isCancelled || delay === undefined) {
          return;
        }
        retryTimer = setTimeout(() => {
          setAttempt(attempt + 1);
        }, delay);
      });

    return () => {
      isCancelled = true;
      clearTimeout(retryTimer);
    };
  }, [attempt, deferredCode, isNear, resolvedTheme]);

  if (!svg) {
    // Also where a diagram waiting on the viewport sits, which is the same
    // thing the reader would have seen mid-stream anyway.
    return (
      <CodeWithCopy content={code} ref={viewportRef}>
        <CodeBlock code={code} language={language} />
      </CodeWithCopy>
    );
  }

  const openInPreview = () => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    // Read the background actually in effect rather than naming a color, so
    // the exported image matches the theme the diagram was rendered for.
    const url = toDiagramImageUrl({
      background: globalThis.getComputedStyle(surface).backgroundColor,
      svg,
    });
    if (url) {
      openFilePreview({
        filename: "diagram.svg",
        mimeType: "image/svg+xml",
        url,
      });
    }
  };

  // A pan ends with a click on the surface it was dragged across, which would
  // otherwise open the preview every time someone finished moving a zoomed
  // diagram around.
  const handleSurfaceClick = (event: React.MouseEvent) => {
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (
      origin &&
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >
        CLICK_SLOP_PX
    ) {
      return;
    }
    openInPreview();
  };

  return (
    <div className="group relative isolate my-4" ref={viewportRef}>
      {/* Its own corner, so a control that comes and goes never shifts the
          buttons opposite it out from under the pointer aiming at them.
          Revealed on focus as well as hover, so tabbing through never lands on
          an invisible control. */}
      {!showSource && (
        <div className="absolute top-1 left-1 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <button
            aria-label={
              isCapturing ? "Release the diagram" : "Zoom this diagram"
            }
            aria-pressed={isCapturing}
            className={cn(
              blockToolbarButtonClassName,
              isCapturing && "bg-accent text-foreground",
            )}
            onClick={() => {
              setCapturing(!isCapturing);
            }}
            title={
              isCapturing
                ? "Release the diagram (Esc)"
                : "Zoom this diagram with the wheel"
            }
            type="button"
          >
            {isCapturing ? (
              <HandGrabbingIcon size={12} />
            ) : (
              <HandIcon size={12} />
            )}
          </button>
          <button
            aria-label="Zoom out"
            className={blockToolbarButtonClassName}
            onClick={zoomOut}
            title="Zoom out"
            type="button"
          >
            <MagnifyingGlassMinusIcon size={12} />
          </button>
          <button
            aria-label="Zoom in"
            className={blockToolbarButtonClassName}
            onClick={zoomIn}
            title="Zoom in"
            type="button"
          >
            <MagnifyingGlassPlusIcon size={12} />
          </button>
          {/* Kept in place rather than mounted on demand: this row sits under
              the pointer that is reaching for it. */}
          <button
            aria-label="Reset zoom"
            className={cn(blockToolbarButtonClassName, "disabled:opacity-40")}
            disabled={!isZoomed}
            onClick={reset}
            title="Reset zoom"
            type="button"
          >
            <ArrowsInIcon size={12} />
          </button>
        </div>
      )}

      <div className="absolute top-1 right-1 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          aria-label={showSource ? "Show diagram" : "Show source"}
          className={blockToolbarButtonClassName}
          onClick={() => {
            setShowSource(!showSource);
          }}
          title={showSource ? "Show diagram" : "Show source"}
          type="button"
        >
          {showSource ? <GraphIcon size={12} /> : <CodeIcon size={12} />}
        </button>
        <CopyButton
          className={blockToolbarButtonClassName}
          iconSize={12}
          onCopy={async () => {
            await navigator.clipboard.writeText(code);
          }}
        />
      </div>

      {showSource ? (
        <CodeBlock code={code} language={language} />
      ) : (
        // `not-prose` on the surface rather than the whole block: the
        // typography styles size and space SVG text as if it were prose, which
        // moves labels off the shapes they name, but the source view above is
        // a code block and wants exactly the styling every other one gets.
        <div
          className={cn(
            "not-prose rounded-md border border-border bg-background",
            // The wheel behaves differently while the diagram holds it, so it
            // has to be visible that it does.
            isCapturing && "ring-2 ring-ring",
          )}
          ref={surfaceRef}
        >
          {/* A diagram wider than the chat column shrinks to fit rather than
              pushing the column open, so zooming is how the detail in a large
              one is read in place; panning is what reaches the part of it
              currently outside the frame. */}
          <div className="overflow-hidden p-3" ref={panViewportRef}>
            <div
              className={cn(
                isZoomed && "cursor-grab [&_button]:cursor-grab",
                // Clicking through to the full-window preview is the other
                // thing this surface does, and it would fire on every attempt
                // to grab the diagram while it is being read in place.
                isCapturing && "[&_button]:pointer-events-none",
              )}
              ref={panContentRef}
            >
              <button
                className="block w-full"
                onClick={handleSurfaceClick}
                onPointerDown={(event) => {
                  dragOriginRef.current = {
                    x: event.clientX,
                    y: event.clientY,
                  };
                }}
                title="Open diagram"
                type="button"
              >
                <div
                  className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
