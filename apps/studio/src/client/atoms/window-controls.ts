import { atomWithStorage } from "jotai/utils";

/**
 * Dev-only: force the chrome a frameless window draws for itself -- the custom
 * Windows/Linux window controls, and the Linux {@link WindowBorder} -- to also
 * render on macOS, so its layout and behavior can be inspected without a
 * Windows/Linux machine. Toggled from the dev panel; persisted so it survives
 * reloads while debugging.
 */
export const forceWindowControlsAtom = atomWithStorage<boolean>(
  "studio.debug.force-window-controls.v1",
  false,
);
