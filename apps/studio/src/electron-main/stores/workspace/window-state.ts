import { workspaceWindowDir } from "@/electron-main/lib/get-workspace-folder";
import { screen } from "electron";
import Store from "electron-store";

import { getKeptState } from "./kept-state";

export interface WindowBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * Which window a remembered size belongs to, by the id it keeps its state
 * under. Each top-level window is its own record: they are open at the same
 * time, and one record between them is each window resizing the other.
 */
export type WindowStateName = string;

/** How many closed windows can come back, newest first; past that, what one kept goes. */
const MAX_CLOSED_WINDOWS = 10;

interface StoredWindowState {
  /** The windows closed while the app ran on, newest first, which can come back. */
  closedIds?: string[];
  /** The windows open now, the one last in front at the end; what a launch brings back. */
  openIds?: string[];
  /** By window, keyed by its name. */
  windows?: Partial<
    Record<string, { bounds?: Partial<WindowBounds>; isMaximized?: boolean }>
  >;
}

interface WindowState {
  bounds: WindowBounds;
  isMaximized: boolean;
}

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

let STORE: null | Store<StoredWindowState> = null;

/**
 * Its own file rather than a key of the workspace's `state` store: a moved or
 * resized window writes here every time it settles, and nothing should hear
 * about that but the next launch.
 */
function getStore(): Store<StoredWindowState> {
  STORE ??= new Store<StoredWindowState>({
    cwd: workspaceWindowDir(),
    name: "window-state",
  });
  return STORE;
}

/** Work areas measured from a maximized window, by display id. */
const learnedWorkAreas = new Map<number, { height: number; width: number }>();

/**
 * The app's UI zoom, as the windows keep it (`zoomAtom`), read here so a
 * window can place its macOS traffic lights for the zoomed toolbar height at
 * creation, rather than waiting for the renderer to mount and report it.
 */
export function getAppZoom() {
  const zoom = getKeptState("view", "zoom.v1");
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0
    ? zoom
    : 1;
}

/**
 * The size and place a window comes back to, or where it opens when nothing
 * was ever remembered for it. `size` is what that window opens at the first
 * time, which is its own rather than one number for every window.
 */
export function getWindowState(
  name: WindowStateName,
  size: { height: number; width: number },
) {
  const stored = getStore().store.windows?.[name];
  const defaults = getDefaultState(size);

  // Merge stored state with defaults to handle partial/corrupted data
  const merged: WindowState = {
    bounds: {
      height: stored?.bounds?.height ?? defaults.bounds.height,
      width: stored?.bounds?.width ?? defaults.bounds.width,
      x: stored?.bounds?.x ?? defaults.bounds.x,
      y: stored?.bounds?.y ?? defaults.bounds.y,
    },
    isMaximized: stored?.isMaximized ?? defaults.isMaximized,
  };

  return keepBelowAutoMaximize(ensureWindowVisible(merged, size));
}

/** Whether a size and place was ever remembered for the window. */
export function hasWindowState(name: WindowStateName) {
  return getStore().store.windows?.[name]?.bounds !== undefined;
}

/**
 * The windows to bring back, the one last in front at the end, and those
 * closed that can still come back, newest first. A workspace last opened by a
 * build with one window has that window, whose record is `first`.
 */
export function rememberedWindowIds(first: string) {
  const { closedIds = [], openIds, windows = {} } = getStore().store;
  return {
    closed: closedIds,
    open: openIds ?? (first in windows ? [first] : []),
  };
}

/** Records a window open, and in front of the others. */
export function rememberWindowInFront(id: string) {
  const { closedIds = [], openIds = [] } = getStore().store;
  getStore().set({
    closedIds: closedIds.filter((closed) => closed !== id),
    openIds: [...openIds.filter((open) => open !== id), id],
  });
}

/**
 * Records a window closed by the person, which can come back. Answers those
 * pushed off the end of what can, whose kept state is the caller's to remove.
 */
export function rememberWindowClosed(id: string): string[] {
  const { closedIds = [], openIds = [], windows } = getStore().store;
  const closed = [id, ...closedIds.filter((other) => other !== id)];
  const gone = closed.slice(MAX_CLOSED_WINDOWS);
  getStore().set({
    closedIds: closed.slice(0, MAX_CLOSED_WINDOWS),
    openIds: openIds.filter((open) => open !== id),
    windows: Object.fromEntries(
      Object.entries(windows ?? {}).filter(([name]) => !gone.includes(name)),
    ),
  });
  return gone;
}

/** Forgets a window altogether: its place, and that it was open. */
export function forgetWindow(id: string) {
  const { closedIds = [], openIds = [], windows } = getStore().store;
  getStore().set({
    closedIds: closedIds.filter((other) => other !== id),
    openIds: openIds.filter((other) => other !== id),
    windows: Object.fromEntries(
      Object.entries(windows ?? {}).filter(([name]) => name !== id),
    ),
  });
}

/** A window's bounds kept on some display, with its size as it asked for. */
export function keepBoundsOnScreen(bounds: WindowBounds): WindowBounds {
  const { workArea } = screen.getDisplayMatching(bounds);
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    height,
    width,
    x: Math.min(
      Math.max(bounds.x, workArea.x),
      workArea.x + workArea.width - width,
    ),
    y: Math.min(
      Math.max(bounds.y, workArea.y),
      workArea.y + workArea.height - height,
    ),
  };
}

export function isWindowBoundsVisible(bounds: WindowBounds) {
  return screen.getAllDisplays().some((display) => {
    return isWindowWithinBounds(bounds, display.bounds);
  });
}

/**
 * Record what a maximized window measured as the work area of the display it
 * filled, which is the only way to learn it under Wayland: a Wayland client is
 * never told about panels or docks, so the display reports the whole output and
 * GNOME's line lands about 10% higher than where the compositor draws it.
 *
 * Kept per display, because a work area learned on a laptop screen would shrink
 * a window the user sized on an external one.
 */
export function rememberWorkAreaFromMaximized(bounds: WindowBounds) {
  learnedWorkAreas.set(screen.getDisplayMatching(bounds).id, {
    height: bounds.height,
    width: bounds.width,
  });
}

export function setWindowState(name: WindowStateName, value: WindowState) {
  getStore().set({ windows: { ...getStore().store.windows, [name]: value } });
}

/**
 * A size GNOME will not maximize on sight, keeping the shape the user left.
 */
export function shrinkBelowAutoMaximize(bounds: WindowBounds) {
  if (process.platform !== "linux") {
    return bounds;
  }

  const display = screen.getDisplayMatching(bounds);
  const workArea = learnedWorkAreas.get(display.id) ?? display.workArea;
  const limit =
    workArea.width * workArea.height * MAX_UNMAXIMIZED_WORK_AREA_FRACTION;
  const area = bounds.width * bounds.height;
  if (area <= limit) {
    return bounds;
  }

  // Scaling both sides by the square root of the shortfall keeps the shape the
  // user left, and flooring keeps the result under the limit rather than on it.
  const scale = Math.sqrt(limit / area);
  return {
    ...bounds,
    height: Math.floor(bounds.height * scale),
    width: Math.floor(bounds.width * scale),
  };
}

function ensureWindowVisible(
  state: WindowState,
  size: { height: number; width: number },
) {
  if (!isWindowBoundsVisible(state.bounds)) {
    const defaultState = getDefaultState(size);
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

function getDefaultState({
  height,
  width,
}: {
  height: number;
  width: number;
}): WindowState {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    bounds: {
      height,
      width,
      x:
        primaryDisplay.bounds.x +
        Math.round((primaryDisplay.bounds.width - width) / 2),
      y:
        primaryDisplay.bounds.y +
        Math.round((primaryDisplay.bounds.height - height) / 2),
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
  return { ...state, bounds: shrinkBelowAutoMaximize(state.bounds) };
}
