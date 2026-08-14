import { useEffect, useRef, useState } from "react";

/** Where the transcript stops, and what that did between one frame and the next. */
export interface TranscriptEdge {
  /** How tall everything the transcript drew is, the frame's own padding aside. */
  contentHeight: number;
  /**
   * What that height did since the frame before this one. Absent until both
   * frames have been drawn, so scrubbing into the middle of a scenario reports
   * nothing rather than a difference against wherever the reader came from.
   */
  delta?: number;
  /** From the bottom of the last row to the bottom of the scroll frame. */
  gap: number;
  /** Where the bottom of the last row sits, measured down the scroll frame. */
  offset: number;
}

/**
 * Measures the bottom of what the transcript drew, in the frame it drew it in.
 *
 * Read off the DOM rather than from the layout pass, because what is being
 * looked for is the gap between the two: a row whose height the rules did not
 * expect is exactly the thing that makes the column jump.
 *
 * `frameRef` wants the element the scroller fills, which is also what the
 * overlay is positioned against.
 */
export function useTranscriptEdge({
  frameRef,
  index,
}: {
  frameRef: React.RefObject<HTMLElement | null>;
  index: number;
}): TranscriptEdge | undefined {
  const [edge, setEdge] = useState<TranscriptEdge>();
  // Height per frame, so a step reports what it changed rather than what the
  // last resize happened to be. A frame can measure several times -- fonts,
  // images, the scroller settling -- and only the last one is that frame's.
  const heights = useRef(new Map<number, number>());

  useEffect(() => {
    const frame = frameRef.current;
    const viewport = frame?.querySelector(
      '[data-slot="message-scroller-viewport"]',
    );
    const content = frame?.querySelector(
      '[data-slot="message-scroller-content"]',
    );
    if (!frame || !viewport || !content) {
      return;
    }

    const measure = () => {
      // The bottom of the last row the transcript drew, which is neither the
      // content box's bottom nor its last child's. The frame carries padding so
      // a reader can scroll past the end, and the scroller keeps a spacer of its
      // own down there for the room a turn needs to reach the top of the
      // viewport; neither is something the transcript drew.
      const style = globalThis.getComputedStyle(content);
      const above = Number.parseFloat(style.paddingTop);
      const box = content.getBoundingClientRect();
      const frameBox = frame.getBoundingClientRect();
      const rows = [...content.children].filter(
        (child) =>
          !(child instanceof HTMLElement) ||
          child.dataset.messageScrollerSpacer === undefined,
      );
      const bottom =
        rows.at(-1)?.getBoundingClientRect().bottom ?? box.top + above;
      const contentHeight = Math.round(bottom - box.top - above);
      heights.current.set(index, contentHeight);
      const before = heights.current.get(index - 1);
      setEdge({
        contentHeight,
        delta: before === undefined ? undefined : contentHeight - before,
        gap: frameBox.bottom - bottom,
        offset: bottom - frameBox.top,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(frame);
    viewport.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", measure);
    };
  }, [frameRef, index]);

  return edge;
}
