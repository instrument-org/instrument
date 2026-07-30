import { cn } from "@/client/lib/utils";
import {
  type PptxViewerController,
  type PresentationSearchResult,
  ReactPptxViewer,
} from "@extend-ai/react-pptx";
import { useEffect, useState } from "react";

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

export function PptxViewer({ url }: { filename: string; url: string }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [railOpen, setRailOpen] = useState(false);
  const [slideCount, setSlideCount] = useState(1);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PresentationSearchResult[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);
  const [controller, setController] = useState<null | PptxViewerController>(
    null,
  );

  // `controller.search` is synchronous and imperative, so it runs on the input
  // event rather than in an effect watching `query`, which would both lag a
  // render behind and re-run the search whenever the controller identity moved.
  const handleQueryChange = (next: string) => {
    setQuery(next);
    if (!controller) {
      return;
    }
    if (next === "") {
      controller.clearSearchHighlights();
      setMatches([]);
      return;
    }
    setMatches(controller.search(next));
    setActiveMatch(0);
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
          onFit={() => {
            void controller?.setFitMode("contain");
          }}
          onZoomChange={setZoom}
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
        <ReactPptxViewer
          className="absolute inset-0 bg-muted/40"
          height="100%"
          onLoad={(presentation) => {
            setSlideCount(Math.max(presentation.document.slides.length, 1));
          }}
          onReady={setController}
          onSlideChange={setSlideIndex}
          showThumbnails={false}
          showToolbar={false}
          slideIndex={slideIndex}
          source={url}
          zoom={zoom * 100}
        />
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
