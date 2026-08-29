import { screen } from "electron";
import Store from "electron-store";

export interface WindowBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface StoredWindowState {
  bounds?: Partial<WindowBounds>;
  isMaximized?: boolean;
  zoom?: number;
}

interface WindowState {
  bounds: WindowBounds;
  isMaximized: boolean;
}

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 900;

// Full containment is too strict for multi-display restores; users can leave a
// window slightly over an edge and still expect that position to be restored.
const MIN_VISIBLE_PX = 100;

// GNOME maximizes any window that maps at more than this share of the work
// area, by area (mutter's auto-maximize, on by default). A saved size just over
// the line therefore comes back maximized on every launch, and unmaximizing
// does not escape it: mutter's own unmaximize shrink keeps the window's aspect
// ratio, which lands back over the line whenever the window is proportionally
// taller than the work area. Restore just under it instead.
const MAX_UNMAXIMIZED_WORK_AREA_FRACTION = 0.8;

const store = new Store<StoredWindowState>({
  name: "window-state",
});

/**
 * The main-window UI zoom the renderer last reported. The renderer owns the
 * value (`zoomAtom`); the main process keeps a copy so a window can place its
 * macOS traffic lights for the zoomed toolbar height at creation, rather than
 * waiting for the renderer to mount and report the zoom back.
 */
export function getMainWindowZoom() {
  const zoom = store.get("zoom");
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0
    ? zoom
    : 1;
}

export function getWindowState() {
  const stored = store.store;
  const defaults = getDefaultState();

  // Merge stored state with defaults to handle partial/corrupted data
  const merged: WindowState = {
    bounds: {
      height: stored.bounds?.height ?? defaults.bounds.height,
      width: stored.bounds?.width ?? defaults.bounds.width,
      x: stored.bounds?.x ?? defaults.bounds.x,
      y: stored.bounds?.y ?? defaults.bounds.y,
    },
    isMaximized: stored.isMaximized ?? defaults.isMaximized,
  };

  return keepBelowAutoMaximize(ensureWindowVisible(merged));
}

export function isWindowBoundsVisible(bounds: WindowBounds) {
  return screen.getAllDisplays().some((display) => {
    return isWindowWithinBounds(bounds, display.bounds);
  });
}

export function setMainWindowZoom(zoom: number) {
  store.set("zoom", zoom);
}

export function setWindowState(value: WindowState) {
  store.set(value);
}

function ensureWindowVisible(state: WindowState) {
  if (!isWindowBoundsVisible(state.bounds)) {
    const defaultState = getDefaultState();
    // Handles unplugged/rearranged monitors by moving only the origin while
    // preserving the user's saved window size.
    return {
      ...state,
      bounds: {
        ...state.bounds,
        x: defaultState.bounds.x,
        y: defaultState.bounds.y,
      },
      isMaximized: false,
    };
  }

  return state;
}

function getDefaultState(): WindowState {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    bounds: {
      height: DEFAULT_HEIGHT,
      width: DEFAULT_WIDTH,
      x:
        primaryDisplay.bounds.x +
        Math.round((primaryDisplay.bounds.width - DEFAULT_WIDTH) / 2),
      y:
        primaryDisplay.bounds.y +
        Math.round((primaryDisplay.bounds.height - DEFAULT_HEIGHT) / 2),
    },
    isMaximized: false,
  };
}

function isWindowWithinBounds(
  windowBounds: WindowBounds,
  displayBounds: { height: number; width: number; x: number; y: number },
) {
  const overlapX =
    Math.min(
      windowBounds.x + windowBounds.width,
      displayBounds.x + displayBounds.width,
    ) - Math.max(windowBounds.x, displayBounds.x);

  const overlapY =
    Math.min(
      windowBounds.y + windowBounds.height,
      displayBounds.y + displayBounds.height,
    ) - Math.max(windowBounds.y, displayBounds.y);

  return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX;
}

function keepBelowAutoMaximize(state: WindowState) {
  if (process.platform !== "linux") {
    return state;
  }

  const { workArea } = screen.getDisplayMatching(state.bounds);
  const limit =
    workArea.width * workArea.height * MAX_UNMAXIMIZED_WORK_AREA_FRACTION;
  const area = state.bounds.width * state.bounds.height;
  if (area <= limit) {
    return state;
  }

  // Scaling both sides by the square root of the shortfall keeps the shape the
  // user left, and flooring keeps the result under the limit rather than on it.
  const scale = Math.sqrt(limit / area);
  return {
    ...state,
    bounds: {
      ...state.bounds,
      height: Math.floor(state.bounds.height * scale),
      width: Math.floor(state.bounds.width * scale),
    },
  };
}
