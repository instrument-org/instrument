/**
 * The IPC channels of the page editor that runs in a page tab's guest: the
 * one synchronous question its preload asks main at document start, and the
 * one it and the window talk on (see `page-editor-messages.ts`). Kept apart
 * from the messages' schema so the sandboxed preload can name them without
 * bundling a validator.
 */

/** The guest preload asks main whether this load is an edit, and gets the editor if it is. */
export const PAGE_EDITOR_BOOT_CHANNEL = "page-editor:boot";

/** Between the editor in the guest and the window that embeds it. */
export const PAGE_EDITOR_CHANNEL = "page-editor";

/**
 * A thumb button pressed over a page, from the guest to the window that
 * embeds it: `"back"` or `"forward"`. The window walks the tab the page is
 * in, the way its row's arrows do, rather than letting the guest step
 * through its own history alone.
 */
export const PAGE_THUMB_CHANNEL = "page-thumb";

/**
 * A key a local page had no use for, from the guest to the window that
 * embeds it: `"up"` or `"down"`, an arrow the page neither answered nor had
 * anything left to scroll with, which a surface walking a folder beside the
 * page takes as a step to the file before or after; or `"escape"`, pressed
 * with nothing of the page's open, which hands the keyboard back to that
 * folder.
 */
export const PAGE_EDGE_CHANNEL = "page-edge";

/**
 * Whether a local page has something open over itself that Escape closes (a
 * modal dialog, full screen, a popover), from the guest to the window, sent
 * each time that changes.
 */
export const PAGE_LAYER_CHANNEL = "page-layer";

/**
 * The window driving a local page while the keyboard stays beside it, from
 * the window to the guest (`PageRemoteMessage`): a key handed to the page,
 * a scroll by a screen, or closing what the page has open.
 */
export const PAGE_REMOTE_CHANNEL = "page-remote";

export type PageRemoteMessage =
  | { key: "ArrowLeft" | "ArrowRight"; type: "key" }
  | { by: -1 | 1; type: "scroll" }
  | { type: "close-layer" };
