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
  if (data?.fullScreen || data?.maximized) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-100 border border-window-border" />
  );
}
