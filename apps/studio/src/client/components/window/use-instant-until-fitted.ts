import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Whether a box's width should land at once rather than slide: true until
 * the box is fitted to the room it was first measured in and styled at that
 * width, so what a screen settles into as it comes up never plays as motion,
 * while every change after it does.
 */
export function useInstantUntilFitted(
  isFitted: boolean,
  box: RefObject<HTMLElement | null>,
) {
  const [isInstant, setInstant] = useState(true);
  useLayoutEffect(() => {
    if (!isInstant || !isFitted) {
      return;
    }
    // Styles the fitted width while transitions are still off, so none
    // starts for it when they come back on.
    void box.current?.offsetWidth;
    setInstant(false);
  }, [box, isFitted, isInstant]);
  return isInstant;
}
