import { cn } from "@/client/lib/utils";
import { useState } from "react";

/**
 * How much of an entrance the image gets, which is a question of how big it is.
 *
 * `icon` is for something at roughly text size -- a favicon in a chip, a
 * reference image in a stack -- where a few pixels of scale reads as the thing
 * settling into place. At thumbnail size and up the same scale reads as a zoom,
 * a second motion competing with the arrival, so `surface` fades and nothing
 * else.
 */
export type ImageArrival = "icon" | "surface";

/**
 * Where an image starts, per entrance. Written out rather than composed so the
 * class scanner reads them whole.
 */
const ARRIVAL_PENDING: Record<ImageArrival, string> = {
  icon: "scale-75 opacity-0",
  surface: "opacity-0",
};

/**
 * One curve for every arrival, so a page whose images land at different moments
 * still lands as one thing happening. Short enough to stay under the load it is
 * covering for.
 */
const ARRIVAL_TRANSITION =
  "transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-none";

/**
 * Every source that has finished loading at least once this session.
 *
 * What the fade is for is an image landing after the layout around it has drawn;
 * one the cache can paint immediately never had that gap, and re-running the
 * fade whenever it remounts -- a transcript scrolling back into view, a grid
 * re-rendering -- would make settled content look like it was still arriving.
 *
 * Keyed by source rather than by element, so the second place to draw the same
 * image is settled from the start. It holds a short string per distinct source
 * and never evicts, which over a session is the list of images that have been
 * on screen.
 */
const arrivedSources = new Set<string>();

/**
 * `pending` is before the load event and `arriving` is the fade it starts.
 * `settled` is both an image that was already here and one whose fade is over:
 * once it is on screen at full opacity there is nothing left to tell apart.
 */
type Phase = "arriving" | "pending" | "settled";

/**
 * Fade an image in when it lands, rather than letting it pop.
 *
 * An image the app draws is nearly always late: a favicon is a round trip to a
 * favicon service, a thumbnail is an asset-origin fetch and a decode. The row
 * around it has already drawn, so what the reader sees is a reserved gap
 * snapping full. Held at zero until the load event and then eased in, the same
 * moment reads as the image arriving -- a slower cousin of the wash a message's
 * words arrive under (`stream-word-in` in `globals.css`).
 *
 * Compose the returned `className` onto the `<img>` and call `onLoad` from its
 * load handler. The element must already hold its own space -- a sized box, an
 * aspect ratio, a frame -- since a fade cannot cover a layout shift, and over
 * one it draws the eye to exactly the thing that moved.
 *
 * Wrong for an image replacing something already on screen: a spinner, a
 * skeleton, an icon standing in until the real one resolves. The stand-in
 * leaves at the moment the fade starts, so the two gaps add up instead of
 * covering for each other, and what the reader sees is a hole. That wants a
 * crossfade, which is a different piece of machinery.
 *
 * The entrance is armed once, at mount. A source that changes under a mounted
 * element swaps without a second fade, which is what a progressively refined
 * preview wants: the frames after the first are the same image getting better,
 * not a new one arriving.
 */
export function useImageArrival(
  src: null | string,
  arrival: ImageArrival = "surface",
): { className: string; onLoad: () => void } {
  const [phase, setPhase] = useState<Phase>(() =>
    src !== null && !arrivedSources.has(src) ? "pending" : "settled",
  );

  return {
    className: cn(
      phase !== "settled" && ARRIVAL_TRANSITION,
      phase === "pending" && ARRIVAL_PENDING[arrival],
    ),
    onLoad: () => {
      if (src !== null) {
        arrivedSources.add(src);
      }
      setPhase((current) => (current === "pending" ? "arriving" : current));
    },
  };
}
