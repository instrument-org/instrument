import { useEffect, useState } from "react";

export interface OutlineHeading {
  element: HTMLElement;
  level: number;
  text: string;
}

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/**
 * Which heading the reader is in, from each heading's top edge in document
 * order and the reading line: the last heading at or above the line, or the
 * first when none has reached it yet.
 *
 * The line sits some way below the top of the viewport rather than on it, so a
 * heading counts as current once it has climbed into the top of the view and
 * not only once it has left it: a heading a quarter of the way down is the one
 * being read, and pinning the line to the top edge would keep the previous
 * section lit until that heading scrolled off entirely.
 *
 * `atEnd` overrides all of that for a document scrolled to its end. The last
 * sections are usually too short to climb to the line, so without it they could
 * never be reached by scrolling and the outline would stall one section short.
 */
export function pickActiveHeading(
  tops: readonly number[],
  readingLine: number,
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
    if (top > readingLine) {
      break;
    }
    active = index;
  }
  return active;
}

/**
 * The index into `headings` of the section being read, tracked as
 * `scrollElement` scrolls and as its contents move; -1 while there are none.
 */
export function useActiveHeading(
  headings: OutlineHeading[],
  scrollElement: HTMLElement | null,
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
      // Every value here is on-screen px, so the ratio survives the app zoom
      // without correction.
      const readingLine = viewport.top + viewport.height / 4;
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
          readingLine,
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
  }, [headings, scrollElement]);

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
