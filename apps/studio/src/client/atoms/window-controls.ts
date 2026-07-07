import { atomWithStorage } from "jotai/utils";

/**
 * Dev-only: force the custom Windows/Linux window controls to also render on
 * macOS so their layout and behavior can be inspected without a Windows/Linux
 * machine. Toggled from the dev panel; persisted so it survives reloads while
 * debugging.
 */
export const forceWindowControlsAtom = atomWithStorage<boolean>(
  "studio.debug.force-window-controls.v1",
  false,
);
