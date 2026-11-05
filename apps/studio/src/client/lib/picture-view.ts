/**
 * Where a picture sits in its pane: how far it is scaled from its fit size,
 * and how far its center is from the pane's, in layout px.
 */
export type PictureView = { scale: number; x: number; y: number };

/** The sizes a view is settled against, the picture's at its fit size. */
export type PictureBox = {
  imageHeight: number;
  imageWidth: number;
  maxScale: number;
  viewHeight: number;
  viewWidth: number;
};

export const FIT_VIEW: PictureView = { scale: 1, x: 0, y: 0 };

const MIN_SCALE = 1;

/** How far a picture at `scale` can move each way from the pane's center. */
export function panReach(box: PictureBox, scale: number) {
  return {
    x: Math.max(0, (box.imageWidth * scale - box.viewWidth) / 2),
    y: Math.max(0, (box.imageHeight * scale - box.viewHeight) / 2),
  };
}

/**
 * The one rule every input ends in. Along each axis a picture larger than the
 * pane keeps its edges at or past the pane's, and one that fits is centered.
 */
export function settleView(view: PictureView, box: PictureBox): PictureView {
  const scale = heldScale(view.scale, box);
  const reach = panReach(box, scale);
  return {
    scale,
    x: Math.min(reach.x, Math.max(-reach.x, view.x)),
    y: Math.min(reach.y, Math.max(-reach.y, view.y)),
  };
}

/**
 * The view at `scale`, held between fit and the cap, that keeps the picture's
 * spot under `point` where it is, with `point` measured from the pane's center
 * in layout px. Pushing past either end changes nothing.
 */
export function zoomedAt(
  view: PictureView,
  scale: number,
  point: { x: number; y: number },
  box: PictureBox,
): PictureView {
  const held = heldScale(scale, box);
  const ratio = held / view.scale;
  return {
    scale: held,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  };
}

function heldScale(scale: number, box: PictureBox) {
  return Math.min(box.maxScale, Math.max(MIN_SCALE, scale));
}
