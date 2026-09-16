import { WindowControls } from "@/client/components/window-controls";
import { cn, isMacOS } from "@/client/lib/utils";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { type ReactNode } from "react";

/**
 * The row across the top of the window: the traffic lights' band, then the
 * tabs. The corner past the lights is empty for now; the tabs start where the
 * chat pane ends below them, so the strip reads as the window's.
 */
export function WindowBar({
  tabs,
  trailing,
}: {
  /** The window's tab strip, which fills the row. */
  tabs: ReactNode;
  /** What the window keeps at its right edge, past the tabs. */
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 border-b border-border bg-background [-webkit-app-region:drag] [&_[role=tab]]:[-webkit-app-region:no-drag] [&_button]:[-webkit-app-region:no-drag]",
        // The lights are drawn by the system over the window's top left; on
        // the platforms that put controls elsewhere the row starts at the edge
        // and ends at the buttons it draws itself, which reach the corner the
        // way the system's own would.
        isMacOS() ? "pr-2" : "pl-2",
      )}
      style={{
        // The band the main process centers the traffic lights in, so the row's
        // height is the one that arithmetic is done against.
        height: `${TOOLBAR_HEIGHT}px`,
        // The gutter the buttons sit in is real pixels the system draws, so it
        // has to stay a fixed visual width: divided by the window's zoom, the
        // zoomed row scales it back to a constant 5rem at every level. That is
        // the 12px cluster inset plus the 52px cluster, leaving the first tab
        // the same air from the lights that the row keeps elsewhere.
        ...(isMacOS()
          ? { paddingLeft: "calc(5rem / var(--app-zoom, 1))" }
          : {}),
      }}
    >
      {/* `min-w-0`: the strip measures its own width and never scrolls, so
        every wrapper between it and the bar has to be allowed to shrink. */}
      <div className="flex min-w-0 flex-1 items-center">{tabs}</div>
      {/* Held against the window's right edge rather than against the last
        tab, so it is chrome the window keeps and not something the strip
        appears to have opened. */}
      {trailing ? (
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      ) : null}
      {/* Nothing on macOS, where the system draws the buttons at the other
        end; the row is their band on the platforms that do not. */}
      <WindowControls />
    </div>
  );
}
