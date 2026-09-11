import { useEffect, useState } from "react";

export interface OutlineHeading {
  element: HTMLElement;
  level: number;
  text: string;
}

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

export interface HeadingRange {
  /** Index of the heading whose section holds the top of the view. */
  end: number;
  /** Index of the last heading above the bottom of the view. */
  start: number;
}

export interface OutlineLayout {
  /** The scroll container's visible height. */
  height: number;
  /**
   * How much of the scroll container's box its own scrollbar takes: a classic
   * scrollbar's width, or 0 for one drawn over the content.
   */
  scrollbarWidth: number;
  /** The width of the layout the outline shares with the document. */
  width: number;
}

/**
 * Which headings' sections are on screen, from each heading's top edge in
 * document order and the edges of the view: the section holding the top edge
 * through the last heading that has climbed above the bottom edge.
 *
 * A section holds the top edge once its heading has passed it, so the range
 * starts at the last heading at or above the top; before any has, the reader
 * is in the preamble, which is the first heading's to claim. The range ends at
 * the last heading above the bottom, and never before it starts.
 *
 * `tolerance` is how much of a section has to show for it to count. The
 * previous section is still on screen by a sliver for the first pixels after
 * its successor's heading passes the top, and a heading a pixel above the
 * bottom edge is a line of text nobody is reading yet; neither should light.
 */
export function pickVisibleHeadings(
  tops: readonly number[],
  viewportTop: number,
  viewportBottom: number,
  tolerance: number,
): HeadingRange | null {
  if (tops.length === 0) {
    return null;
  }
  let start = 0;
  let end = 0;
  for (const [index, top] of tops.entries()) {
    if (top <= viewportTop + tolerance) {
      start = index;
    }
    if (top < viewportBottom - tolerance) {
      end = index;
    }
  }
  return { end: Math.max(start, end), start };
}

/** The headings inside `scrollElement`, kept current as the document redraws. */
export function useMarkdownHeadings(scrollElement: HTMLElement | null) {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }

    let frame = 0;
    const read = () => {
      frame = 0;
      setHeadings(readHeadings(scrollElement));
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(read);
    };

    read();
    // The document is drawn more than once: the optional plugin bundles land
    // after the first render, and code blocks swap in their highlighted markup
    // when it arrives. Each of those can add, drop, or replace a heading.
    const observer = new MutationObserver(schedule);
    observer.observe(scrollElement, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [scrollElement]);

  return headings;
}

/**
 * The sizes the outline lays itself out against, all in layout px so they hold
 * under the app zoom: read off `offsetWidth` and `clientHeight` rather than a
 * bounding rect, which is on-screen px.
 *
 * `width` is the row's rather than the scroll container's, since the column
 * the answer decides on takes its share of the latter -- measured there, a
 * column would open and close on its own width.
 */
export function useOutlineLayout(
  scrollElement: HTMLElement | null,
  layoutElement: HTMLElement | null,
): OutlineLayout {
  const [layout, setLayout] = useState<OutlineLayout>({
    height: 0,
    scrollbarWidth: 0,
    width: 0,
  });

  useEffect(() => {
    if (!scrollElement || !layoutElement) {
      return;
    }

    const measure = () => {
      const next: OutlineLayout = {
        height: scrollElement.clientHeight,
        scrollbarWidth: scrollElement.offsetWidth - scrollElement.clientWidth,
        width: layoutElement.offsetWidth,
      };
      setLayout((current) =>
        current.height === next.height &&
        current.scrollbarWidth === next.scrollbarWidth &&
        current.width === next.width
          ? current
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    // A classic scrollbar appears when the content outgrows the box, which
    // resizes the content and not the box; the content is observed for that,
    // and re-observed as the document swaps what it holds.
    const observeContent = () => {
      for (const child of scrollElement.children) {
        observer.observe(child);
      }
    };
    const content = new MutationObserver(() => {
      observeContent();
      measure();
    });

    measure();
    observer.observe(scrollElement);
    observer.observe(layoutElement);
    observeContent();
    content.observe(scrollElement, { childList: true });

    return () => {
      observer.disconnect();
      content.disconnect();
    };
  }, [layoutElement, scrollElement]);

  return layout;
}

/**
 * The range of `headings` whose sections are in view, tracked as
 * `scrollElement` scrolls and as its contents move; null while there are none.
 * `tolerance` is in on-screen px, like everything measured here.
 */
export function useVisibleHeadings(
  headings: OutlineHeading[],
  scrollElement: HTMLElement | null,
  tolerance: number,
) {
  const [range, setRange] = useState<HeadingRange | null>(null);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewport = scrollElement.getBoundingClientRect();
      // Every value here is on-screen px, so the ratio survives the app zoom
      // without correction.
      const next = pickVisibleHeadings(
        headings.map((heading) => heading.element.getBoundingClientRect().top),
        viewport.top,
        viewport.bottom,
        tolerance,
      );
      setRange((current) =>
        current?.start === next?.start && current?.end === next?.end
          ? current
          : next,
      );
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(measure);
    };

    measure();
    scrollElement.addEventListener("scroll", schedule, { passive: true });
    // A narrower viewer reflows the prose and moves every heading, and so does
    // anything that changes height in place -- a code block unfolding, an
    // image arriving -- which the document's own box reports and no scroll
    // event does.
    const observer = new ResizeObserver(schedule);
    observer.observe(scrollElement);
    for (const child of scrollElement.children) {
      observer.observe(child);
    }

    return () => {
      cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [headings, scrollElement, tolerance]);

  return range;
}

/**
 * The headings as the document rendered them, which is the only reading that
 * is right: a `#` inside a fenced block is a comment and never becomes one, a
 * heading written in raw HTML only becomes one once the HTML pass has landed,
 * and the element itself is what a jump scrolls to. A second parse of the
 * source would have to reproduce every one of those decisions to agree.
 */
function readHeadings(root: HTMLElement): OutlineHeading[] {
  return [...root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)]
    .map((element) => ({
      element,
      level: Number(element.tagName.slice(1)),
      text: element.textContent.replaceAll(/\s+/g, " ").trim(),
    }))
    .filter((heading) => heading.text !== "");
}
