import { useEffect, useRef, useState } from "react";

/** How far outside the viewport still counts as near, so work finishes before
 * the element is actually looked at. */
const DEFAULT_ROOT_MARGIN = "400px";

/**
 * Reports when an element first comes near the viewport, for content too
 * expensive to render where nobody is looking.
 *
 * The answer latches: once near, always near. Un-rendering something the reader
 * has already scrolled past would throw away work and make scrolling back up
 * cost more than scrolling down, and the memory a rendered diagram holds is not
 * what hurts — the main-thread time to produce it is, and that is already
 * spent.
 *
 * Deliberately not debounced. Scrolling quickly through a long run of
 * elements does trigger each one it crosses, which is no worse than rendering
 * them all on mount, and a delay would tax the case that actually matters:
 * an element already on screen when the message opens.
 */
export function useNearViewport<T extends HTMLElement>({
  rootMargin = DEFAULT_ROOT_MARGIN,
}: { rootMargin?: string } = {}): {
  isNear: boolean;
  ref: React.RefObject<null | T>;
} {
  const ref = useRef<null | T>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || isNear) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNear(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isNear, rootMargin]);

  return { isNear, ref };
}
