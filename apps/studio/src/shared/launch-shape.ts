import { TOOLBAR_HEIGHT, WINDOW_CARD_GAP, windowCardTop } from "./constants";
import { type CardInsets } from "./kept-state";

/** The card's corners, `rounded-[18px]` in `window-frame.tsx`, in layout px. */
const CARD_RADIUS = 18;

/**
 * The window's shape with nothing in it, drawn until the page's own first
 * render replaces it: its ground, the card where it was left, and the band of
 * the card's tab row, in the theme's colors, with the band across the top
 * dragging the window as the page's own does. The launch's first window
 * shows it while main loads (`electron-main/windows/launch-page.ts`), and the
 * preload draws it again under the app page until its window frame is up.
 */
export const LAUNCH_SHAPE_HTML =
  '<div class="launch-shape" aria-hidden="true"><div class="launch-shape-card"><div class="launch-shape-row"></div></div><div class="launch-shape-bar"></div></div>';

/** What the page draws once its window frame is up, when the shape goes for good. */
export const WINDOW_UP_SELECTOR = '[data-testid="app-page"]';

/**
 * The shape's rules. The colors are `globals.css`'s `--ground`, `--pane`,
 * `--border` and `--elevation-xs`, written out, so a change there is made
 * here too.
 */
export function launchShapeCss({
  insets,
  isMac,
  zoom,
}: {
  /** Where the card stood, in px from the window's edges; the full width less the gap where the window kept none. */
  insets: CardInsets | undefined;
  isMac: boolean;
  /** The app's zoom (`zoom.v1`), which scales everything laid out in layout px. */
  zoom: number;
}) {
  const px = (layout: number) => `${String(Math.round(layout * zoom))}px`;
  const top = windowCardTop(isMac);
  const left = insets ? `${String(insets.left)}px` : px(WINDOW_CARD_GAP);
  const right = insets ? `${String(insets.right)}px` : px(WINDOW_CARD_GAP);
  return `
.launch-shape {
  --ground: color-mix(in oklab, #e7e5e4 25%, #f5f5f4);
  --pane: color-mix(in oklab, #fafaf9 35%, #f5f5f4);
  --border: #e7e5e4;
  --edge: 0 1px 2px 0 rgb(10 13 18 / 0.04), 0 1px 1px 0 rgb(10 13 18 / 0.05), 0 0 0 1px rgb(10 13 18 / 0.05);
  position: fixed;
  inset: 0;
  /* Under whatever the page draws before its window frame is up. */
  z-index: -1;
  background: var(--ground);
}
@media (prefers-color-scheme: dark) {
  .launch-shape {
    --ground: color-mix(in oklab, #0f0d0c 50%, #1c1917);
    --pane: #1c1917;
    --border: rgb(255 255 255 / 10%);
    --edge: 0 0 0 1px rgb(255 255 255 / 0.06), 0 0 0 2px rgb(0 0 0 / 0.04);
  }
}
.launch-shape-card {
  position: absolute;
  top: ${px(top)};
  right: ${right};
  bottom: ${px(WINDOW_CARD_GAP)};
  left: ${left};
  border-radius: ${px(CARD_RADIUS)};
  background: var(--pane);
  box-shadow: var(--edge);
}
.launch-shape-row {
  box-sizing: border-box;
  height: ${px(TOOLBAR_HEIGHT)};
  border-bottom: 1px solid var(--border);
}
.launch-shape-bar {
  position: absolute;
  inset: 0 0 auto 0;
  height: ${px(top + TOOLBAR_HEIGHT)};
  app-region: drag;
}
`;
}
