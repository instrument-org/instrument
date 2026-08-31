import { forceWindowControlsAtom } from "@/client/atoms/window-controls";
import { isLinux } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useSyncExternalStore } from "react";

/**
 * A hairline outline around the main window on an X11 session, where the window
 * is frameless and nothing else draws an edge for it. Without this the light
 * theme is hard to pick out from a light window behind it. Windows gets its edge
 * from DWM, and macOS keeps its native frame, so neither needs one.
 *
 * Wayland is the reason this is not simply "on Linux". Electron chooses the
 * frame layout for a frameless window on whether it is running X11 before
 * anything else, and only the X11 one draws no shadow and no border: elsewhere
 * the window gets client-side decorations with both, and the same hairline is a
 * second line inside the first.
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

  return <WindowBorderOutline forceShow={forceShow} />;
}

const readPixelRatio = () => window.devicePixelRatio;

/**
 * `devicePixelRatio` is a plain global, so a render that read it is one React
 * Compiler may cache and never repeat. Subscribing makes it tracked state, and
 * re-arming the query at the new ratio keeps it correct across more than one
 * move between displays of different scales.
 */
function subscribeToPixelRatio(onChange: () => void) {
  let media = window.matchMedia(`(resolution: ${readPixelRatio()}dppx)`);
  const handle = () => {
    media.removeEventListener("change", handle);
    media = window.matchMedia(`(resolution: ${readPixelRatio()}dppx)`);
    media.addEventListener("change", handle);
    onChange();
  };
  media.addEventListener("change", handle);
  return () => {
    media.removeEventListener("change", handle);
  };
}

/**
 * Split out so the window-state subscription only runs on the platform that
 * draws a border.
 */
function WindowBorderOutline({ forceShow }: { forceShow: boolean }) {
  const { data } = useQuery(
    rpcClient.utils.live.windowState.experimental_liveOptions(),
  );
  const { data: protocol } = useQuery(
    rpcClient.utils.displayProtocol.queryOptions(),
  );
  const pixelRatio = useSyncExternalStore(
    subscribeToPixelRatio,
    readPixelRatio,
  );

  // An edge against the screen has nothing to separate the window from, and a
  // line there reads as an artifact. Chromium drops its own frame border in
  // these states for the same reason.
  if (!data || data.fullScreen || data.maximized) {
    return null;
  }

  // Drawn only where nothing else draws one. Waiting for the answer rather than
  // assuming it keeps a Wayland window from showing a second edge for as long
  // as the query takes, which is the wrong way round to be wrong.
  if (!forceShow && protocol !== "x11") {
    return null;
  }

  // Anchored to the viewport, so a live resize costs nothing but a CSS reflow:
  // the box stretches with the window instead of waiting on a measurement to
  // catch up. The inset is what keeps it inside the window. Under a fractional
  // display scale the viewport rounds up past the surface the compositor paints
  // -- at 1.25x a 1406px-wide window reports a viewport 1.5 device pixels wider
  // -- so a hairline flush with the viewport edge lands outside the window and
  // never reaches the screen, leaving only the top and left visible. That
  // overhang comes from rounding the surface into whole CSS pixels, so it is
  // under a pixel wide and does not vary with the window's size; an integer
  // scale divides evenly and has none.
  const inset = Number.isInteger(pixelRatio) ? 0 : 1;

  return (
    <div
      className="pointer-events-none fixed top-0 left-0 z-100 border border-window-border"
      style={{ bottom: inset, right: inset }}
    />
  );
}
