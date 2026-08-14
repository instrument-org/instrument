import { MAX_ZOOM, MIN_ZOOM } from "@/client/lib/zoom-levels";
import { useLayoutEffect, useState } from "react";

// Space left either side of fitted content, so a page does not sit flush
// against the scrollbar and the panel edge.
const GUTTER = 32;

/**
 * Zoom state that can be pinned to "whatever makes the content span its
 * container", and stays pinned across container resizes until the user picks a
 * level themselves.
 *
 * Fit has to be a mode rather than a one-shot because the two things that
 * change the available width -- dragging the artifact panel's splitter and
 * zooming the app -- are both continuous. A level computed once is wrong by the
 * end of the first drag, which reads as the control not working.
 *
 * The PDF viewer does not use this: pdfium's zoom plugin has its own
 * `ZoomMode.FitWidth` that already re-fits, and re-fitting it from here would
 * be two mechanisms fighting. This is for the formats whose engine takes only a
 * scale factor, so the fit has to come from a measured width.
 *
 * `contentWidth` is the content's natural width in CSS pixels at 100%: a DOCX
 * page's `pageWidthPx`, a slide's EMU width converted to pixels. Pass 0 while
 * it is still unknown and the fit holds until it arrives.
 *
 * The caller owns `container` rather than this handing back a ref, because both
 * callers already hold that element as state for their own scroll and page
 * measurement.
 */
export function useFitWidth({
  container,
  contentWidth,
  initialFit = false,
}: {
  container: HTMLElement | null;
  contentWidth: number;
  initialFit?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [isFit, setIsFit] = useState(initialFit);

  // A layout effect rather than a passive one: the fit is measured off the
  // container, and both callers open fitted, so running after paint would show
  // a frame of the document at 100% before it snapped down to fit.
  useLayoutEffect(() => {
    if (!isFit || !container || contentWidth <= 0) {
      return;
    }

    const apply = () => {
      const available = container.clientWidth - GUTTER;
      // A container that has not been laid out yet leaves nothing to fit
      // against, and what comes out of dividing by it is the floor of the zoom
      // range rather than a reading of anything. That is the level the control
      // then shows until the width arrives -- a document opening at 50% for a
      // tenth of a second and settling somewhere else. The observer below is
      // what brings the real width in.
      if (available <= 0) {
        return;
      }
      const next = Math.min(
        Math.max(available / contentWidth, MIN_ZOOM),
        MAX_ZOOM,
      );
      // Rounded to whole percent, and only applied when that whole percent
      // moves. A splitter drag delivers a resize per frame, and for DOCX every
      // distinct scale is a re-layout of the document, so passing through every
      // sub-percent difference is most of what makes the drag feel heavy.
      setZoom((current) =>
        Math.round(next * 100) === Math.round(current * 100) ? current : next,
      );
    };

    apply();
    // Coalesced to one recompute per frame: a drag can deliver several resize
    // records in the same frame, and only the last one is worth acting on.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container, contentWidth, isFit]);

  return {
    /** Pin to fit-width, and stay there while the container resizes. */
    fit: () => {
      setIsFit(true);
    },
    isFit,
    /** Pick a fixed level, which releases the fit. */
    selectZoom: (level: number) => {
      setIsFit(false);
      setZoom(level);
    },
    zoom,
  };
}
