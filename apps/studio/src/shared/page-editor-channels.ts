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
