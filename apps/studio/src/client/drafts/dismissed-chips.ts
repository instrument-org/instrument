import { atom } from "jotai";

/**
 * The chips of what was on screen that the person dismissed, by draft and
 * then by the chip's key (see `ContextItem`). Kept in the window while the
 * app runs and never written anywhere, so a dismissed chip may come back
 * after a relaunch.
 */
export const dismissedChipsAtom = atom<
  Readonly<Record<string, readonly string[]>>
>({});

/**
 * Drafts a link from outside made. What is on screen may be the site's doing
 * (a folder a link had just opened), so such a draft takes none of it while
 * the app runs, only what the person chooses to add.
 */
export const linkDraftsAtom = atom<ReadonlySet<string>>(new Set<string>());
