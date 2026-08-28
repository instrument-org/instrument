import { type ReactNode, useEffect, useRef } from "react";

/**
 * A Markdown table, in a block that takes the room the transcript has before it
 * resorts to scrolling.
 *
 * The geometry is all in `markdown-table-row` / `markdown-table-frame`; this
 * only reports which edges still have table behind them, so the fade and the
 * pinned first column appear when they mean something. That has to be measured:
 * `scroll-state(scrollable:)` container queries would answer it in CSS alone,
 * but Chromium has not shipped that half of scroll-state yet, and the
 * scroll-timeline approach `scroll-fade-y` uses holds its last value when a
 * scroller stops being scrollable -- which here is every time the browser pane
 * closes.
 */
export const MarkdownTable = ({ children }: { children?: ReactNode }) => {
  const frameRef = useRef<HTMLDivElement>(null);

  // Attributes rather than state: a scroll handler that re-renders every table
  // in the transcript is the one thing a transcript cannot afford, and nothing
  // about these two edges is React's to know.
  const sync = () => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const behind = frame.scrollWidth - frame.clientWidth - frame.scrollLeft;
    frame.toggleAttribute("data-scroll-start", frame.scrollLeft > 1);
    frame.toggleAttribute("data-scroll-end", behind > 1);
  };

  // After every render, which is what catches the table growing a column at a
  // time while it streams: the frame is already at its cap by then, so its own
  // size never changes and no observer fires.
  useEffect(sync);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    frame.addEventListener("scroll", sync, { passive: true });
    // The frame's width moves when the pane does, which raises no scroll event
    // and no render.
    const observer = new ResizeObserver(sync);
    observer.observe(frame);

    return () => {
      frame.removeEventListener("scroll", sync);
      observer.disconnect();
    };
    // `sync` reads the ref and closes over nothing, so the empty deps are what
    // keep the listener from being torn down and re-added every chunk.
  }, []);

  return (
    <div className="markdown-table-row">
      <div
        className="markdown-table-frame scrollbar-thin scrollbar-color"
        ref={frameRef}
      >
        <table>{children}</table>
        <span aria-hidden className="markdown-table-fade" />
      </div>
    </div>
  );
};
