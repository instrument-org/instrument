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

// One-way word that a code editor took or gave up the keyboard, which the
// main process reads before every key press reaches the page. See
// bindAppWindowChords in electron-main/menus/app-window.
export const CODE_EDITOR_FOCUS_CHANNEL = "code-editor-focus";

// The renderer's captured exceptions, serialized, for the main process to
// build and keep as events. Its own channel rather than oRPC, so a capture
// still arrives when RPC is what broke. See electron-main/lib/renderer-exceptions.
export const CAPTURE_EXCEPTION_CHANNEL = "capture-exception";

// One-way word that a window reached a point of its launch, which the main
// process logs beside its own boot steps (`electron-main/lib/boot-timing`), so
// a launch is timed to when the window is usable, not only to its first paint.
export const BOOT_MARK_CHANNEL = "boot-mark";

/**
 * Where the launch's first window draws the window's shape while the rest of
 * main loads (`electron-main/windows/launch-page.ts`), on the renderer's own
 * origin so the page that replaces it keeps its process. The preload reads
 * nothing from main there, since what answers it is not up yet.
 */
export const LAUNCH_PAGE_PATH = "/launch/";

/** The points a window's launch reaches that it tells the main process of. */
export const BOOT_MARKS = ["first render", "chat list read"] as const;
export type BootMark = (typeof BOOT_MARKS)[number];

export const TOOLBAR_HEIGHT = 40;
/** The ground an app window leaves above its card, in layout px: the tab strips stand under it, and the window's top row with them. */
export const WINDOW_CARD_GAP = 8;

/** The ground above the card off the Mac, in layout px, which the system's caption buttons stand on. */
export const CAPTION_HEIGHT = 32;

/** The ground above the card, in layout px. */
export function windowCardTop(isMac: boolean) {
  return isMac ? WINDOW_CARD_GAP : CAPTION_HEIGHT;
}

/** How tall the band from the window's top that its tab strips draw in stands, in layout px. */
export function stripBand(isMac: boolean) {
  return TOOLBAR_HEIGHT + windowCardTop(isMac) - WINDOW_CARD_GAP;
}
export const SIDEBAR_WIDTH = 250;
