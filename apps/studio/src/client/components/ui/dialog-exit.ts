import { type AnimationEvent } from "react";

/**
 * Builds an `onAnimationEnd` handler that fires `onExitComplete` once this
 * element's own `data-[state=closed]:animate-out` exit animation finishes (not a
 * bubbled animation from a child), letting callers defer clearing their content
 * until the close animation has played instead of guessing its duration. Shared
 * by Dialog and AlertDialog so the detection isn't hand-copied per primitive.
 */
export function handleContentExitAnimation(
  onAnimationEnd: ((event: AnimationEvent<HTMLDivElement>) => void) | undefined,
  onExitComplete: (() => void) | undefined,
) {
  return (event: AnimationEvent<HTMLDivElement>) => {
    onAnimationEnd?.(event);
    if (
      onExitComplete &&
      event.target === event.currentTarget &&
      event.currentTarget.dataset.state === "closed"
    ) {
      onExitComplete();
    }
  };
}
