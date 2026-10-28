// Synchronous request the preload makes for the resolved theme, before the
// document is parsed. See serveResolvedTheme in electron-main/lib/theme-utils.
export const RESOLVE_THEME_CHANNEL = "resolve-theme";

// Synchronous request the preload makes for where setup is, so the window's
// first render is setup's and not the app's for a frame. See serveSetupState
// in electron-main/lib/serve-setup-state.
export const SETUP_STATE_CHANNEL = "setup-state";

// One-way request to hand a file to the OS as a native drag. Sent rather than
// invoked because the drag has to start while the pointer is still down: an
// awaited round trip can outlive the gesture. See electron-main/lib/file-drag.
export const START_FILE_DRAG_CHANNEL = "start-file-drag";

// Main's word to every window that fingers came down on the trackpad to
// scroll ("down") or lifted ("up"), which a page's wheel events never say.
// macOS only. See electron-main/lib/trackpad-touches.
export const TRACKPAD_TOUCH_CHANNEL = "trackpad-touch";

// One-way word that a code editor took or gave up the keyboard, which the
// main process reads before every key press reaches the page. See
// bindAppWindowChords in electron-main/menus/app-window.
export const CODE_EDITOR_FOCUS_CHANNEL = "code-editor-focus";

// The renderer's captured exceptions, serialized, for the main process to
// build and keep as events. Its own channel rather than oRPC, so a capture
// still arrives when RPC is what broke. See electron-main/lib/renderer-exceptions.
export const CAPTURE_EXCEPTION_CHANNEL = "capture-exception";

export const TOOLBAR_HEIGHT = 40;
export const SIDEBAR_WIDTH = 250;
