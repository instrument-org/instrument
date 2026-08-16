import { type ReactNode } from "react";

/**
 * The panel itself. The window is transparent and frameless, so this is the
 * whole of what you see: rounded corners and a border we own rather than ones
 * the platform draws.
 */
export function OverlayShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-screen min-h-0 w-screen flex-col overflow-hidden rounded-xl border border-border bg-popover">
      {children}
    </div>
  );
}
