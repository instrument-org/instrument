import * as React from "react";

/**
 * How long a picture's place has to stay on screen before it asks for the
 * picture. A picture asked for is drawn whether or not anyone is still there
 * to see it (main never hears an image's request cancelled), so a row a
 * scroll only passes over, or a row a list keeps drawn just past its edge,
 * asks for nothing.
 */
export const ASK_AFTER_MS = 200;

/** Every picture asked for this session, which is on hand or on its way. */
const asked = new Set<string>();

/**
 * The `src` for a file's picture, which every thumbnail asks through: `url`
 * once the element `ref` is put on has been on screen for {@link ASK_AFTER_MS},
 * or at once for a picture already asked for this session; undefined until
 * then.
 */
export function useSeenSrc(url: null | string | undefined): {
  ref: (element: Element | null) => void;
  src: string | undefined;
} {
  const [element, setElement] = React.useState<Element | null>(null);
  const [isOnScreen, setIsOnScreen] = React.useState(false);
  const [settled, setSettled] = React.useState<null | string>(null);
  React.useEffect(() => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      setIsOnScreen(entry?.isIntersecting ?? false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const src = url && (settled === url || asked.has(url)) ? url : undefined;
  React.useEffect(() => {
    if (!url || !isOnScreen || src === url) return;
    const timer = window.setTimeout(() => {
      asked.add(url);
      setSettled(url);
    }, ASK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [isOnScreen, src, url]);
  return { ref: setElement, src };
}
