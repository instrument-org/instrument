import { useEffect, useState } from "react";

import { cn } from "./utils";

/**
 * Sources whose bytes have all arrived and been decoded this session, so an
 * `<img>` naming one paints whole in its first frame.
 */
const decoded = new Set<string>();
const decoding = new Map<string, Promise<void>>();

/**
 * Load and decode an image ahead of the element that draws it. Chromium
 * draws an image as its bytes arrive, so one that comes in slowly (anything
 * the `app:` protocol serves while the main process is busy) shows top to
 * bottom in bands; one decoded here is whole the moment it is drawn. A source
 * that fails to load settles too, so nothing waits on it for good, and where
 * images cannot be decoded ahead (jsdom has no `decode`) every source counts
 * as decoded at once.
 */
export function decodeImage(src: string): Promise<void> {
  const pending = decoding.get(src);
  if (pending) {
    return pending;
  }
  const image = new Image();
  if (typeof image.decode !== "function") {
    decoded.add(src);
    return Promise.resolve();
  }
  image.src = src;
  const done = image
    .decode()
    .catch(() => undefined)
    .then(() => {
      decoded.add(src);
    });
  decoding.set(src, done);
  return done;
}

function isImageDecoded(src: string): boolean {
  return decoded.has(src);
}

/**
 * Whether every one of `sources` is decoded (`decodeImage`), starting any
 * not yet asked for. True from the first render when they already are, so a
 * picture shown before never fades in again.
 */
function useImagesDecoded(sources: readonly string[]): boolean {
  const [ready, setReady] = useState(() => sources.every(isImageDecoded));
  const key = sources.join("\n");
  useEffect(() => {
    if (ready) {
      return;
    }
    let live = true;
    void Promise.all(key.split("\n").map(decodeImage)).then(() => {
      if (live) {
        setReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, [key, ready]);
  return ready;
}

/**
 * The classes that keep an element showing `sources` hidden until they are
 * decoded, then fade it in. Nothing at all when they were decoded before it
 * mounted, since there was no wait to cover. Composed last, so it overrides
 * an opacity the element sets for itself.
 */
export function useDecodedEntrance(sources: readonly string[]): {
  className: string;
  ready: boolean;
} {
  const ready = useImagesDecoded(sources);
  const [waited] = useState(!ready);
  return {
    className: cn(
      waited &&
        "transition-opacity duration-200 ease-out motion-reduce:transition-none",
      !ready && "opacity-0",
    ),
    ready,
  };
}
