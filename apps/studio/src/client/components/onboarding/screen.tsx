import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

/**
 * The scrollable body of a single onboarding step. Owns the concerns every
 * onboarding screen shares so no screen re-implements (or forgets) them:
 *
 * - A single scroll region (`overflow-y-auto`) with a `min-h-full` growth track,
 *   so content is vertically centered while it fits the window but scrolls from
 *   the top once it's taller (e.g. under OS zoom, where the layout viewport
 *   shrinks). Without this, an overflowing centered screen clips its top/bottom
 *   with no way to reach them.
 * - A top inset (`pt-14`) that clears the macOS traffic-light drag strip so the
 *   brand mark never collides with it when content is scrolled to the top.
 *
 * Screens pass just their content plus an alignment and an optional pinned
 * `footer`; padding can be overridden via `className` (e.g. wider gutters for
 * form steps).
 */
export function OnboardingScreen({
  align = "center",
  children,
  className,
  footer,
}: {
  align?: "between" | "center" | "top";
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div
        className={cn("flex min-h-full flex-col px-6 pt-14 pb-6", className)}
      >
        <div
          className={cn(
            "flex flex-1 flex-col",
            align !== "top" && "items-center",
            align === "center" && "justify-center",
            align === "between" && "justify-between",
          )}
        >
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 justify-center pt-6">{footer}</div>
        )}
      </div>
    </div>
  );
}
