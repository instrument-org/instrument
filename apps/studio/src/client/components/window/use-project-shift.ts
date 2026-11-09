import { type RefObject, useLayoutEffect, useRef } from "react";

/** How far the list travels as it settles into a project or back out. */
const SHIFT_PX = 24;
const SHIFT_MS = 260;

/**
 * Slides the element in as the project it shows changes, the way a
 * navigation stack pushes and pops: from the right into a project or from
 * one project to another, from the left back out to the inbox. Played on the
 * element already drawn, so nothing in it remounts and the list keeps its
 * rows, its focus and its scroll. Nothing on the first draw, and nothing
 * where the reader asked for less motion.
 */
export function useProjectShift(
  ref: RefObject<HTMLElement | null>,
  projectId: string | undefined,
) {
  const shown = useRef(projectId);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = projectId;
    const element = ref.current;
    if (
      before === projectId ||
      !element ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const from = projectId === undefined ? -SHIFT_PX : SHIFT_PX;
    element.animate(
      [
        { opacity: 0, transform: `translateX(${from}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: SHIFT_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }, [projectId, ref]);
}
