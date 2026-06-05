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

const store = new Store<StoredWindowState>({
  name: "window-state",
});

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

  return ensureWindowVisible(merged);
}

export function isWindowBoundsVisible(bounds: WindowBounds) {
  return screen.getAllDisplays().some((display) => {
    return isWindowWithinBounds(bounds, display.bounds);
  });
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
