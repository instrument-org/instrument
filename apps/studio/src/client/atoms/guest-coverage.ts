import { atom } from "jotai";

/**
 * Number of full-window overlays currently drawn over the page. Every dim layer
 * registers here while it is mounted (see `useCoversGuests`), and a host showing
 * a browser guest stops taking the page's chords while this is non-zero (see
 * `useIsGuestCovered`).
 *
 * A count rather than a flag: overlays are independent slots and a menu
 * accelerator can open one over another, so the page is uncovered by the last
 * one to close, not the first.
 */
export const coveringOverlayCountAtom = atom(0);
