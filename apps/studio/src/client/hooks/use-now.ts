import { useEffect, useState } from "react";

/**
 * The current time, for elapsed durations that have to keep counting.
 *
 * A duration that stops advancing is worse than none: it reads as the moment
 * the thing ended. Pick the interval from the coarsest unit shown -- a second
 * where seconds are on screen, a slower tick where the text only moves once a
 * minute and a faster one would re-render for nothing.
 */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
