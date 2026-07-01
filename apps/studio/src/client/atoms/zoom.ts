import { rpcClient } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { getDefaultStore } from "jotai";
import { atomWithStorage } from "jotai/utils";

const ZOOM_MAX = 3;
const ZOOM_MIN = 0.5;
export const ZOOM_STEP = 0.1;

/**
 * Whole-shell UI zoom, applied as the CSS `zoom` property on the AppShell root.
 * Persisted so the user keeps their zoom across launches; `getOnInit` applies it
 * before first paint to avoid a zoom flash on boot. Independent of the agent
 * browser's guest content, which lives outside the zoomed root.
 */
export const zoomAtom = atomWithStorage<number>(
  "studio.zoom.v1",
  1,
  undefined,
  {
    getOnInit: true,
  },
);

// Keeps the main process's macOS traffic-light position in sync with zoom.
function reportZoom() {
  void safe(
    rpcClient.tabs.syncZoom.call({ zoom: getDefaultStore().get(zoomAtom) }),
  );
}
reportZoom();
getDefaultStore().sub(zoomAtom, reportZoom);

export function clampZoom(value: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}
