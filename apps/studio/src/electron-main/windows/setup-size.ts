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

/** Setup's shape, centered on the display the pointer is on. */
export function setupBounds() {
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
