import { atom } from "jotai";

/**
 * Number of open modals that should block tab navigation. Any open `<Dialog>`
 * registers here (see `DialogContent`), and `useAppCommands` ignores tab
 * open/close/switch commands while it's non-zero, so keyboard shortcuts like
 * Cmd+T / Cmd+W can't move the user out from under a modal.
 */
export const blockingModalCountAtom = atom(0);
