// Synchronous request the preload makes for the resolved theme, before the
// document is parsed. See serveResolvedTheme in electron-main/lib/theme-utils.
export const RESOLVE_THEME_CHANNEL = "resolve-theme";

// One-way request to hand a file to the OS as a native drag. Sent rather than
// invoked because the drag has to start while the pointer is still down: an
// awaited round trip can outlive the gesture. See electron-main/lib/file-drag.
export const START_FILE_DRAG_CHANNEL = "start-file-drag";

export const TOOLBAR_HEIGHT = 40;
export const SIDEBAR_WIDTH = 250;
