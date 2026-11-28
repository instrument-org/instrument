import { useLayoutEffect, useState } from "react";

/**
 * Below this width, in CSS px, a built-in page (Settings, History) folds
 * what it keeps beside its content: Settings' sidebar to a rail of icons,
 * History's list of filters to pills. Half a window, as a side of a
 * tab group is, is under it; a whole window is over it.
 */
export const PAGE_FOLD_PX = 640;

/**
 * Whether an element is narrower than a width, measured as it resizes: a
 * container query the page's own code can read, since what folds is drawn
 * differently rather than restyled. Layout px, the units a container query
 * reads, whatever the zoom. Undefined until the element is first measured,
 * so a page that animates the change can mount at the measured width.
 */
export function useIsNarrower(element: HTMLElement | null, px: number) {
  const [isNarrow, setIsNarrow] = useState<boolean>();
  useLayoutEffect(() => {
    if (!element) {
      return;
    }
    const measure = () => {
      setIsNarrow(element.offsetWidth < px);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, px]);
  return isNarrow;
}
