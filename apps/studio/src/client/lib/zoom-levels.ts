// Shared by the toolbar's zoom menu and by viewers that have to clamp their
// engine to the same range. Kept out of `viewer-toolbar.tsx` so that file only
// exports components and stays fast-refreshable.
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// Derived rather than restated, so reordering or extending the list above
// cannot leave the toolbar's disabled states pointing at the wrong stops.
export const MIN_ZOOM = Math.min(...ZOOM_LEVELS);
export const MAX_ZOOM = Math.max(...ZOOM_LEVELS);
