import { useEffect, useState } from "react";

import { MAX_ZOOM, MIN_ZOOM } from "./zoom-levels";

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

  useEffect(() => {
    if (!isFit || !container || contentWidth <= 0) {
      return;
    }

    const apply = () => {
      const available = container.clientWidth - GUTTER;
      setZoom(
        Math.min(Math.max(available / contentWidth, MIN_ZOOM), MAX_ZOOM),
      );
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => {
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
