// localStorage keys for renderer view state that is also read outside of its
// owning atom, notably by the boot shell (`boot-shell.ts`), which sizes the
// pre-mount window frame before jotai (or anything else) is loaded.

export const SIDEBAR_OPEN_STORAGE_KEY = "studio.sidebar-open.v1";
export const SIDEBAR_WIDTH_STORAGE_KEY = "studio.sidebar-width.v1";
export const ZOOM_STORAGE_KEY = "studio.zoom.v1";
