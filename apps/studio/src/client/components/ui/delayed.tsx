import { type ReactNode, useEffect, useState } from "react";

/**
 * How long a wait goes unmarked. Most of what the app waits on (a folder
 * listed from disk, a query already cached) answers well inside this, and a
 * loader drawn for those flashes up and away, which reads as a flicker rather
 * than as progress.
 */
export const LOADER_DELAY_MS = 300;

/**
 * Draws its children only once they have been wanted for a moment: mounted
 * while something is loading, a loader inside it appears only for a wait long
 * enough to need one, and a quicker wait shows nothing at all.
 */
export function Delayed({
  children,
  ms = LOADER_DELAY_MS,
}: {
  children: ReactNode;
  ms?: number;
}) {
  const [isShown, setIsShown] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setIsShown(true);
    }, ms);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [ms]);
  return isShown ? children : null;
}
