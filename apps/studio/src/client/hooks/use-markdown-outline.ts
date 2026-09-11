import { useEffect, useState } from "react";

export interface OutlineHeading {
  element: HTMLElement;
  level: number;
  text: string;
}

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

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
 * Which heading the reader is in, from each heading's top edge in document
 * order and the top of the view: the last heading at or above the top, whose
 * section is the one holding that edge, or the first when none has reached it
 * yet, since a preamble is the first heading's to claim.
 *
 * `tolerance` is how much of the previous section may still show before the
 * new one counts. A section is on screen by a sliver for the first pixels
 * after its successor's heading passes the top, and the reader is not in it.
 *
 * `atEnd` overrides all of that for a document scrolled to its end. The last
 * sections are usually too short to reach the top, so without it they could
 * never be reached by scrolling and the outline would stall one short.
 */
export function pickActiveHeading(
  tops: readonly number[],
  viewportTop: number,
  tolerance: number,
  atEnd: boolean,
): number {
  if (tops.length === 0) {
    return -1;
  }
  if (atEnd) {
    return tops.length - 1;
  }
  let active = 0;
  for (const [index, top] of tops.entries()) {
    if (top > viewportTop + tolerance) {
      break;
    }
    active = index;
  }
  return active;
}

/**
 * The index into `headings` of the section being read, tracked as
 * `scrollElement` scrolls and as its contents move; -1 while there are none.
 * `tolerance` is in on-screen px, like everything measured here.
 */
export function useActiveHeading(
  headings: OutlineHeading[],
  scrollElement: HTMLElement | null,
  tolerance: number,
) {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewport = scrollElement.getBoundingClientRect();
      // A document that fits without scrolling is not "at its end": there the
      // first section is the one being read, not the last.
      const atEnd =
        scrollElement.scrollTop > 0 &&
        scrollElement.scrollTop + scrollElement.clientHeight >=
          scrollElement.scrollHeight - 1;
      setActive(
        pickActiveHeading(
          headings.map(
            (heading) => heading.element.getBoundingClientRect().top,
          ),
          viewport.top,
          tolerance,
          atEnd,
        ),
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

  return active;
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
