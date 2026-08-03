import { useEffect, useState } from "react";

/**
 * Which page is being read, as a one-based number, from the bottom edge of
 * every rendered page and the top edge of the viewport.
 *
 * The page filling the top of the view is the one being read: the first whose
 * bottom edge has not yet passed above it. The obvious alternative -- whichever
 * page shows the most area -- gets this wrong in any viewport tall enough to
 * hold two pages, because there the second page draws level with the first as
 * soon as the first is scrolled by a single pixel. The count then moves to page
 * two while page one is still whole on screen, and only returns while the
 * scroll sits in the few pixels of gutter above the first page.
 */
export function pickVisiblePage(
  pages: { bottom: number; index: number }[],
  viewportTop: number,
) {
  const ordered = [...pages].sort((a, b) => a.index - b.index);
  // Falling back to the last rendered page rather than the first matters while
  // a viewer virtualizes: between dropping the pages behind the reader and
  // mounting the one ahead, every page it still holds can be above the
  // viewport, and answering "page 1" there flashes the count back to the top of
  // the document.
  const reading =
    ordered.find((page) => page.bottom > viewportTop) ?? ordered.at(-1);
  return (reading?.index ?? 0) + 1;
}

/**
 * Tracks the page under the top of `scrollElement`, as a one-based number.
 *
 * Pages are found by an attribute carrying their zero-based index, which each
 * viewer's own markup (or its library's) supplies. Only the pages currently
 * rendered need to be present: a viewer that virtualizes has already dropped
 * the ones far above, and those could not be the answer anyway.
 */
export function useVisiblePage({
  pageIndexAttribute,
  scrollElement,
}: {
  pageIndexAttribute: string;
  scrollElement: HTMLElement | null;
}) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const pages = [
        ...scrollElement.querySelectorAll<HTMLElement>(
          `[${pageIndexAttribute}]`,
        ),
      ]
        .map((element) => ({
          bottom: element.getBoundingClientRect().bottom,
          index: Number(element.getAttribute(pageIndexAttribute)),
        }))
        .filter((entry) => Number.isFinite(entry.index));

      setPage(
        pickVisiblePage(pages, scrollElement.getBoundingClientRect().top),
      );
    };

    const schedule = () => {
      frame ||= requestAnimationFrame(measure);
    };

    schedule();
    scrollElement.addEventListener("scroll", schedule, { passive: true });
    // Pages mount and unmount as a viewer virtualizes, which changes what is
    // measurable without any scrolling having happened.
    const observer = new MutationObserver(schedule);
    observer.observe(scrollElement, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [pageIndexAttribute, scrollElement]);

  return page;
}
