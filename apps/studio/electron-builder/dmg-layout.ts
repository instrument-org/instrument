/**
 * Where things sit in the Mac disk image's window, in points. The window is
 * the size of `build/background.png` (electron-builder reads it from the
 * image), and the art in it is drawn around these same positions by
 * `scripts/generate-dmg-background.ts`, so moving an icon here means
 * regenerating the art.
 *
 * Icon positions are the icon's center, as Finder places them.
 */
export const DMG_LAYOUT = {
  appIcon: { x: 200, y: 200 },
  applicationsIcon: { x: 500, y: 200 },
  height: 380,
  iconSize: 128,
  iconTextSize: 13,
  width: 660,
};
