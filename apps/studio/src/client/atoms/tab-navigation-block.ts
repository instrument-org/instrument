import { atom } from "jotai";

/**
 * Number of open modals that should block tab navigation. An app-wide modal
 * registers here (see `useBlockTabNavigation`), and `useWindowCommands`
 * ignores the tab chords while it's non-zero, so shortcuts like Cmd+T and
 * Cmd+W can't move the user out from under a modal.
 */
export const blockingModalCountAtom = atom(0);

/**
 * What back does while something is holding the window, innermost last: a
 * page inside a modal registers after the modal it sits in, so back leaves
 * the page first and the modal next (see `useModalBack`). Back never reaches
 * the tab behind while a modal blocks navigation, whether or not anything is
 * registered here.
 */
export const modalBackStackAtom = atom<readonly { run: () => void }[]>([]);
