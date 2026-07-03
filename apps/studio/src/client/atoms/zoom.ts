import { atomWithStorage, createJSONStorage } from "jotai/utils";

const ZOOM_MAX = 2;
const ZOOM_MIN = 0.5;
export const ZOOM_STEP = 0.1;

export function clampZoom(value: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

const json = createJSONStorage<number>(() => localStorage);

// Clamp on read so a corrupt/legacy value (e.g. 0, which makes
// `calc(100vh / var(--app-zoom))` invalid and blanks the whole shell) can't
// brick the window.
const zoomStorage: typeof json = {
  ...json,
  getItem: (key, initialValue) => {
    const value = json.getItem(key, initialValue);
    return typeof value === "number" && Number.isFinite(value)
      ? clampZoom(value)
      : initialValue;
  },
};

/**
 * Whole-shell UI zoom, applied as the CSS `zoom` property on the AppShell root.
 * Persisted so the user keeps their zoom across launches; `getOnInit` applies it
 * before first paint to avoid a zoom flash on boot. Independent of the agent
 * browser's guest content, which lives outside the zoomed root. AppShell reports
 * changes to the main process (macOS traffic-light position) so this stays a
 * plain view-state atom with no import-time side effects.
 */
export const zoomAtom = atomWithStorage<number>(
  "studio.zoom.v1",
  1,
  zoomStorage,
  {
    getOnInit: true,
  },
);
