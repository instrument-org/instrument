import { atomWithStorage } from "jotai/utils";

/**
 * Dev-only: force the edge a frameless window draws for itself on Linux
 * ({@link WindowBorder}) to also render on macOS, so it can be inspected
 * without a Linux machine. Toggled from the App states debug page; persisted so it survives
 * reloads while debugging.
 */
export const forceWindowControlsAtom = atomWithStorage<boolean>(
  "studio.debug.force-window-controls.v1",
  false,
);
