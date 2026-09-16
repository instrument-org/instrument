import { useEffect, useState } from "react";

/**
 * The clock a list reads its "how long ago" and its day heads from, ticking
 * once a minute: one clock for the whole render, so every row is measured from
 * the same moment and the list is re-read on the tick rather than per row.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
