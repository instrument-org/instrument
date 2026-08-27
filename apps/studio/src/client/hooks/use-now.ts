import { useEffect, useState } from "react";

/**
 * How often anything reading this re-renders. Minute-resolution, so a slower
 * tick would show a stale number and a faster one would re-render for nothing.
 */
const ELAPSED_TICK_MS = 30_000;

/**
 * The current time, for elapsed durations that have to keep counting.
 *
 * Shared by the header pill and by a promoted command's card, which are two
 * places showing how long the same process has been going. A duration that
 * stops advancing is worse than none: it reads as the moment the thing ended.
 */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, ELAPSED_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
