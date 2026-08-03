import { cn } from "@/client/lib/utils";
import {
  type PptxViewerController,
  type PresentationSearchResult,
  ReactPptxViewer,
} from "@extend-ai/react-pptx";
import { type CSSProperties, useEffect, useState } from "react";

import { useFitWidth } from "./use-fit-width";
import { ViewerBody } from "./viewer-surface";
import {
  ViewerFindControl,
  ViewerPageControl,
  ViewerRailToggle,
  ViewerToolbar,
  ViewerToolbarSpacer,
  ViewerZoomControl,
} from "./viewer-toolbar";

import "@extend-ai/react-pptx/styles.css";

// OOXML measures slide geometry in English Metric Units.
const EMU_PER_PIXEL = 9525;

// The library insets its slide surface by 34px (18px once the *window* is under
// 760px wide, which has nothing to do with how wide this panel is). That inset
// is width the fit has already handed to the slide, so the slide overhangs the
// surface by exactly that much: Chrome keeps the leading inset and drops the
// trailing one from the scroll region, which reads as a slide pushed right.
// Studio's gutter comes from the fit instead, so the horizontal inset goes.
const VIEWPORT_STYLE = {
  paddingInline: 0,
  // Where a scrollbar takes layout space, reserving it on both edges keeps the
  // gutter even, and keeps a slide sitting near the panel's height from
  // resizing itself in a loop as the scrollbar appears and disappears.
  scrollbarGutter: "stable both-edges",
} satisfies CSSProperties;

export function PptxViewer({ url }: { filename: string; url: string }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [slideCount, setSlideCount] = useState(1);
  const [slideWidth, setSlideWidth] = useState(0);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PresentationSearchResult[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);
  const [controller, setController] = useState<null | PptxViewerController>(
    null,
  );
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  // `controller.setFitMode` cannot drive this: `zoom` below is a controlled
  // prop, so whatever the library computes for a fit mode is overwritten by
  // the next render with our own number. Fitting therefore means computing the
  // number ourselves and continuing to hand it over.
  //
  // Measured off the library's own slide surface rather than the element around
  // it, so the width the fit scales against is the width the slide is laid out
  // in -- scrollbar included, since that is the one part of it the panel's own
  // box cannot see.
  const { fit, isFit, selectZoom, zoom } = useFitWidth({
    container: viewport,
    contentWidth: slideWidth,
    initialFit: true,
  });

  // `controller.search` is synchronous and imperative, so it runs on the input
  // event rather than in an effect watching `query`, which would both lag a
  // render behind and re-run the search whenever the controller identity moved.
  const runSearch = (target: PptxViewerController, next: string) => {
    if (next === "") {
      target.clearSearchHighlights();
      setMatches([]);
      return;
    }
    setMatches(target.search(next));
    setActiveMatch(0);
  };

  const handleQueryChange = (next: string) => {
    setQuery(next);
    if (controller) {
      runSearch(controller, next);
    }
  };

  const current = matches[activeMatch];
  useEffect(() => {
    if (controller && current) {
      void controller.highlightSearchResult(current);
    }
  }, [controller, current]);

  const goToMatch = (delta: number) => {
    if (matches.length === 0) {
      return;
    }
    setActiveMatch((index) => {
      const next = (index + delta) % matches.length;
      return next < 0 ? next + matches.length : next;
    });
  };

  return (
    <>
      <ViewerToolbar>
        <ViewerRailToggle
          onToggle={() => {
            setRailOpen((open) => !open);
          }}
          open={railOpen}
        />
        <ViewerPageControl
          count={slideCount}
          label="slide"
          onPageChange={(page) => {
            setSlideIndex(page - 1);
          }}
          page={slideIndex + 1}
        />
        <ViewerZoomControl
          isFit={isFit}
          onFit={fit}
          onZoomChange={selectZoom}
          zoom={zoom}
        />
        <ViewerToolbarSpacer />
        <ViewerFindControl
          activeMatch={activeMatch}
          matchCount={matches.length}
          onNextMatch={() => {
            goToMatch(1);
          }}
          onPreviousMatch={() => {
            goToMatch(-1);
          }}
          onQueryChange={handleQueryChange}
          query={query}
        />
      </ViewerToolbar>

      <ViewerBody
        rail={
          <PptxSlideRail
            activeIndex={slideIndex}
            controller={controller}
            onSelect={setSlideIndex}
            slideCount={slideCount}
          />
        }
        railOpen={railOpen}
      >
        {/* The library's own toolbar and thumbnail rail are off: this viewer
            supplies both from Studio's chrome so every format matches.

            `height` becomes the min and max height of the slide workspace, and
            defaults to a `min(76vh, 780px)` clamp that leaves the bottom of the
            panel empty however tall the panel is. A percentage resolves against
            this element, which `inset-0` has already sized. */}
        <div className="absolute inset-0">
          <ReactPptxViewer
            className="size-full bg-muted/40"
            // Studio owns the fit, so the library must not apply its own. Its
            // default `contain` resolves to `min(1, viewport / slideWidth)` and
            // is *multiplied* by the zoom handed in, so a fitted slide in a
            // panel narrower than the slide's natural width was scaled down
            // twice. The clamp at 1 is why it looked correct in a wide panel:
            // the second factor only bites once there is less room than the
            // slide wants.
            fitMode="none"
            height="100%"
            onLoad={(presentation) => {
              setSlideCount(Math.max(presentation.document.slides.length, 1));
              // The deck carries its slide size in EMUs, the OOXML unit. Divided
              // out, it is the width one slide occupies at 100% zoom, which is
              // what fit-width scales against.
              setSlideWidth(
                presentation.document.size.widthEmu / EMU_PER_PIXEL,
              );
            }}
            onReady={(ready) => {
              setController(ready);
              // A query typed while the deck was still parsing had no controller
              // to run against, so it is searched once one exists.
              if (query !== "") {
                runSearch(ready, query);
              }
            }}
            onSlideChange={setSlideIndex}
            onViewportReady={setViewport}
            showThumbnails={false}
            showToolbar={false}
            slideIndex={slideIndex}
            source={url}
            viewportStyle={VIEWPORT_STYLE}
            zoom={zoom * 100}
          />
        </div>
      </ViewerBody>
    </>
  );
}

/**
 * Slides stay live DOM/SVG surfaces rather than rasterized images, so each
 * thumbnail is a detached render the library paints into a host element we
 * provide and tears down through the returned cleanup.
 */
function PptxSlideRail({
  activeIndex,
  controller,
  onSelect,
  slideCount,
}: {
  activeIndex: number;
  controller: null | PptxViewerController;
  onSelect: (index: number) => void;
  slideCount: number;
}) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: slideCount }, (_, index) => (
        <button
          className={cn(
            "flex flex-col items-center gap-1 rounded-md p-1",
            activeIndex === index ? "bg-accent" : "hover:bg-muted",
          )}
          key={index}
          onClick={() => {
            onSelect(index);
          }}
          type="button"
        >
          <PptxSlideThumbnail controller={controller} index={index} />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {index + 1}
          </span>
        </button>
      ))}
    </div>
  );
}

function PptxSlideThumbnail({
  controller,
  index,
}: {
  controller: null | PptxViewerController;
  index: number;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!controller || !host || !controller.isReady()) {
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void controller.renderThumbnail(index, host).then(
      (dispose) => {
        if (disposed) {
          dispose();
        } else {
          cleanup = dispose;
        }
      },
      () => {
        // A slide that fails to render leaves an empty placeholder rather than
        // taking down the rail.
      },
    );

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [controller, host, index]);

  return (
    <div
      className="aspect-video w-[88px] overflow-hidden rounded-xs bg-white shadow-sm"
      ref={setHost}
    />
  );
}
