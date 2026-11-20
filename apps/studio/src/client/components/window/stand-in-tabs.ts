import { atom } from "jotai";

import type { WindowTabs } from "./tab-model";

/**
 * Tabs read in place of the window's own, in a store that draws a picture
 * of a window rather than the window (a debug page's frames): what
 * `useWindowTabs` reads there, which nothing there changes, and where
 * nothing takes a drop (`useDropTarget`). Unset in the window's own store.
 */
export const standInTabsAtom = atom<WindowTabs | undefined>(undefined);
