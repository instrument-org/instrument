import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-accent", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

/**
 * Stands in for words on their way, on their line and as wide as `children`,
 * so nothing moves when they land. It takes the color of the text around it,
 * which keeps it visible on a button as well as in a row. Assistive tech hears
 * "Loading", so a button whose label it stands in for still has a name.
 */
function SkeletonText({ children }: { children: ReactNode }) {
  return (
    <span
      className="animate-pulse rounded-sm bg-current/15"
      data-slot="skeleton-text"
    >
      <span className="invisible">{children}</span>
      <span className="sr-only">Loading</span>
    </span>
  );
}

export { Skeleton, SkeletonText };
