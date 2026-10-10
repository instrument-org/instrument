import { atom } from "jotai";

/**
 * What holds the window over the tab behind it (a dialog, a draft or a chat
 * grown over the row), in the order they came up. While any does,
 * `useWindowCommands` keeps the tab chords and history off the tab behind:
 * back and Cmd+W close the innermost hold that can close, Cmd+T closes them
 * all and opens the window's new tab, and the rest wait. See
 * `useHoldWindow`.
 */
export const windowHoldsAtom = atom<readonly { close?: () => void }[]>([]);

/**
 * What back does while something is holding the window, innermost last: a
 * page inside a modal registers after the modal it sits in, so back leaves
 * the page first and the modal next (see `useModalBack`). Back never reaches
 * the tab behind while the window is held, whether or not anything is
 * registered here.
 */
export const modalBackStackAtom = atom<readonly { run: () => void }[]>([]);
