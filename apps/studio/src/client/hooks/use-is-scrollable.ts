import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Whether a list runs past its own height, measured whenever it or any
 * row in it changes size, and as rows come and go. The fade has to be
 * taken off a list that stops scrolling, since its scroll timeline holds
 * the last fade it drew once the list fits.
 */
export function useIsScrollable(ref: RefObject<HTMLDivElement | null>) {
  const [isScrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setScrollable(element.scrollHeight > element.clientHeight);
    };
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(element);
      for (const child of element.children) {
        sizes.observe(child);
      }
      measure();
    };
    const rows = new MutationObserver(watch);
    rows.observe(element, { childList: true });
    watch();
    return () => {
      rows.disconnect();
      sizes.disconnect();
    };
  }, [ref]);
  return isScrollable;
}
