import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

/**
 * A provider's mark on a white tile: 40 (Figma's name; 48 across) starts a
 * row, 64 heads a sign-in page. `badge` is the small round mark at its
 * corner that says what went wrong (a warning, a clock).
 */
export function BrandTile({
  badge,
  children,
  size = 64,
}: {
  badge?: ReactNode;
  /** The mark, sized by the tile. */
  children: ReactNode;
  size?: 40 | 64;
}) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center border bg-card shadow-xs",
        size === 64
          ? "size-16 rounded-[17px] [&>span:not([data-badge])]:size-10 [&>svg]:size-10"
          : "size-12 rounded-xl [&>span:not([data-badge])]:size-7.5 [&>svg]:size-7.5",
      )}
    >
      {children}
      {badge && (
        <span
          className="absolute -right-2 -bottom-2 flex size-7 items-center justify-center rounded-full bg-warning-100 text-warning-700 ring-2 ring-background [&_svg]:size-3.5"
          data-badge
        >
          {badge}
        </span>
      )}
    </span>
  );
}
