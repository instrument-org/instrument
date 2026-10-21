import { getMachineState } from "@/electron-main/stores/machine/state";
import { type SetupState } from "@/shared/setup";
import { screen } from "electron";

/** The app window's shape while setup is up on a first run. */
const SETUP_WIDTH = 1080;
const SETUP_HEIGHT = 720;

/**
 * Whether the window opens at setup's own shape: setup is up, and not only
 * for a step an update added, which someone meets in the window as they left
 * it.
 */
export function opensSetupSized(state: SetupState) {
  return state.step !== null && !state.isNewStepOnly;
}

/**
 * Setup's shape: where it was before the app last quit with setup up, while
 * that is still on a display, else centered on the display the pointer is on.
 */
export function setupBounds() {
  const at = getMachineState().get("setupWindowAt");
  if (at && isOnADisplay(at)) {
    return { height: SETUP_HEIGHT, width: SETUP_WIDTH, ...at };
  }
  const { workArea } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  return {
    height: SETUP_HEIGHT,
    width: SETUP_WIDTH,
    x: workArea.x + Math.round((workArea.width - SETUP_WIDTH) / 2),
    y: workArea.y + Math.round((workArea.height - SETUP_HEIGHT) / 2),
  };
}

/** Keeps where setup's window is, for the next launch to open it there. */
export function keepSetupWindowPlace({ x, y }: { x: number; y: number }) {
  getMachineState().set("setupWindowAt", { x, y });
}

/** Forgets it, once setup is done and the window has its own place back. */
export function forgetSetupWindowPlace() {
  getMachineState().delete("setupWindowAt");
}

/** Whether the middle of the window's top edge is on some display's work area. */
function isOnADisplay({ x, y }: { x: number; y: number }) {
  const point = { x: x + SETUP_WIDTH / 2, y: y + 1 };
  return screen
    .getAllDisplays()
    .some(
      ({ workArea }) =>
        point.x >= workArea.x &&
        point.x < workArea.x + workArea.width &&
        point.y >= workArea.y &&
        point.y < workArea.y + workArea.height,
    );
}
