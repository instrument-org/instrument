import { atom } from "jotai";

/**
 * Number of open modals that should block tab navigation. An app-wide modal
 * registers here (see `useBlockTabNavigation`), and `useWindowCommands`
 * ignores the tab chords while it's non-zero, so shortcuts like Cmd+T and
 * Cmd+W can't move the user out from under a modal.
 */
export const blockingModalCountAtom = atom(0);
