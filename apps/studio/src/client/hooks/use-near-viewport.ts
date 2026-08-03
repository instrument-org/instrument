import { useEffect, useRef, useState } from "react";

/** How far outside the scroll port still counts as near, so work finishes
 * before the element is actually looked at. */
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
      { root: nearestScrollPort(element), rootMargin },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isNear, rootMargin]);

  return { isNear, ref };
}

/**
 * The scroll container the element sits in, or `null` for the window.
 *
 * `rootMargin` expands the observer's root and nothing else. A target is
 * clipped by every scrolling ancestor on the way up before the expanded root
 * rect is ever consulted, so watching the window from inside one discards the
 * head start entirely: the element is reported near only once it is already on
 * screen, which for expensive content means the reader watches it appear.
 */
function nearestScrollPort(element: Element): Element | null {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const { overflowY } = globalThis.getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") {
      return parent;
    }
  }
  return null;
}
