import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

/**
 * A provider's mark on a white tile: 40 sits in a way card beside another,
 * 64 heads a sign-in page. `badge` is the small round mark at its corner
 * that says what went wrong (a warning, a clock).
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
          ? "size-16 rounded-[17px] [&>svg]:size-10 [&>span:not([data-badge])]:size-10"
          : "size-12 rounded-xl [&>svg]:size-7.5 [&>span:not([data-badge])]:size-7.5",
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

/**
 * One way forward on a page that offers a few, as a card: its marks, a
 * title, a line, and its buttons at the foot. One button is the card's main
 * way (`brand`); two are plain buttons stacked.
 */
export function WayCard({
  children,
  icons,
  line,
  title,
}: {
  /** The card's buttons, full width. */
  children: ReactNode;
  /** An app icon or `BrandTile`s, side by side. */
  icons: ReactNode;
  line: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex w-72.5 max-w-full flex-col gap-1 rounded-[20px] border bg-card p-5 shadow-xs">
      <div className="flex gap-1.5 pb-2.5">{icons}</div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{line}</p>
      <div className="mt-auto flex flex-col gap-2 pt-6 [&>button]:h-10 [&>button]:w-full [&>button]:text-base">
        {children}
      </div>
    </div>
  );
}
