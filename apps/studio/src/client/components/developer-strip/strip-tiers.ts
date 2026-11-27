/**
 * When each part of the developer strip shows, by the strip's width. As it
 * narrows, parts give way in this order: the shortcut hints, the workspace, the
 * debug buttons, the flags, the api, the words beside the icons, then the
 * version. The build's name truncates in whatever is left.
 *
 * Each width fits everything shown at that tier at its longest: Windows'
 * spelled-out shortcuts, a chat's notes cell, a two-digit error count and a
 * truncated workspace name. `developer-strip.browser.test.tsx` sweeps the widths.
 */
export const STRIP_TIER = {
  api: "hidden @4xl:flex",
  /** An icon standing in for a cell's words, until they fit. */
  icon: "@3xl:hidden",
  debug: "hidden @6xl:flex",
  flags: "hidden @5xl:flex",
  shortcut: "hidden @min-[90rem]:inline",
  version: "hidden @2xl:inline",
  words: "hidden @3xl:inline",
  workspace: "hidden @7xl:flex",
};
