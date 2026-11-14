/**
 * Where things sit in the Mac disk image's window, in points. The window is
 * the size of `build/background.png` (electron-builder reads it from the
 * image), and the art in it is drawn around these same positions by
 * `scripts/generate-dmg-background.ts`, so moving an icon here means
 * regenerating the art.
 *
 * Finder takes that size as the whole window, title bar included, and draws
 * the picture from below the title bar, so the picture's bottom title bar's
 * worth (32 points on macOS 26) is never seen. A Finder set to show the path
 * bar and status bar covers about 60 points more. Everything that matters sits
 * in the top 300 or so.
 *
 * Icon positions are the icon's center, as Finder places them.
 */
export const DMG_LAYOUT = {
  appIcon: { x: 200, y: 200 },
  applicationsIcon: { x: 500, y: 200 },
  height: 432,
  iconSize: 128,
  iconTextSize: 13,
  width: 660,
};
