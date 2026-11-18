import { useLocation } from "@tanstack/react-router";
import { type ReactNode } from "react";

/**
 * A debug page's scroller, named by the page's path for scroll restoration.
 *
 * Restoration finds an unnamed scroller by its place in the DOM, and every
 * debug page's scroller sits in the same place, so an unnamed one would open
 * at the offset the page before it was left at. Named by path, a page opens at
 * its top and Back still returns to where it was.
 */
export function DebugPageScroller({
  children,
  className = "size-full overflow-y-auto",
}: {
  children: ReactNode;
  className?: string;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div className={className} data-scroll-restoration-id={pathname}>
      {children}
    </div>
  );
}
