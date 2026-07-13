// Desktop Chrome's zoom ladder (percent). Zooming in/out snaps to the
// neighboring rung rather than adding a fixed step, so the readout lands on
// familiar stops (100, 110, 125, 150, ...) instead of arbitrary values after a
// trackpad pinch. Shared by the app-window UI zoom and the in-app browser guest
// zoom; each passes its own min/max so the ladder is restricted to that range
// and the ends clamp there.
const ZOOM_LADDER_PERCENTS = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
];

/**
 * The next zoom factor when stepping in/out from `factor`, snapping to the
 * neighboring ladder rung within [min, max] and clamping at the ends. Works in
 * factor units (1 = 100%) to match CSS `zoom` and Electron's `setZoomFactor`.
 */
export function steppedZoom({
  direction,
  factor,
  max,
  min,
}: {
  direction: "in" | "out";
  factor: number;
  max: number;
  min: number;
}): number {
  const percent = factor * 100;
  const rungs = ZOOM_LADDER_PERCENTS.filter(
    (p) => p >= min * 100 && p <= max * 100,
  );
  // Epsilon so a factor already sitting on a rung advances to the next one
  // instead of returning itself.
  const next =
    direction === "in"
      ? rungs.find((p) => p > percent + 0.5)
      : rungs.findLast((p) => p < percent - 0.5);
  const bounded = next ?? (direction === "in" ? max * 100 : min * 100);
  return bounded / 100;
}
