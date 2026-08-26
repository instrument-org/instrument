import { forceWindowControlsAtom } from "@/client/atoms/window-controls";
import { isLinux } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

/**
 * A hairline outline around the main window on Linux, where the window is
 * frameless and nothing else draws an edge for it: Electron paints a border and
 * shadow for a frameless window only under native Wayland, and Studio pins Ozone
 * to X11. Without this the light theme is hard to pick out from a light window
 * behind it. Windows gets its edge from DWM, and macOS keeps its native frame,
 * so neither needs one.
 *
 * Mounted outside {@link ZoomRoot} so it stays a single hairline at every UI
 * zoom. It separates the window from the desktop, which makes it a property of
 * the window rather than of the chrome that scales with the app.
 */
export function WindowBorder() {
  const forceShow = useAtomValue(forceWindowControlsAtom);

  if (!isLinux() && !forceShow) {
    return null;
  }

  return <WindowBorderOutline />;
}

/**
 * Split out so the window-state subscription only runs on the platform that
 * draws a border.
 */
function WindowBorderOutline() {
  const { data } = useQuery(
    rpcClient.utils.live.windowState.experimental_liveOptions(),
  );

  // An edge against the screen has nothing to separate the window from, and a
  // line there reads as an artifact. Chromium drops its own frame border in
  // these states for the same reason.
  if (!data || data.fullScreen || data.maximized) {
    return null;
  }

  // Sized from the window rather than stretched to the viewport with `inset-0`.
  // Under a fractional display scale the viewport rounds up past the surface the
  // compositor paints -- at 1.25x a 1406px-wide window reports a viewport 1.5
  // device pixels wider -- so a hairline on its right or bottom edge lands
  // outside the window and never reaches the screen, leaving only the top and
  // left visible.
  return (
    <div
      className="pointer-events-none fixed top-0 left-0 z-100 border border-window-border"
      style={{ height: data.contentHeight, width: data.contentWidth }}
    />
  );
}
