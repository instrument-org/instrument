import { clampZoom, zoomAtom } from "@/client/atoms/zoom";
import { IMAGE_PANZOOM_VIEWPORT_CLASS } from "@/client/hooks/use-image-panzoom";
import { normalizeWheelDeltaPx } from "@/client/lib/utils";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

// Per-event exponent scale mapping wheel delta to a zoom multiplier.
const ZOOM_WHEEL_SENSITIVITY = 0.0015;

/**
 * Drives the shared UI zoom from ctrl+wheel and trackpad pinch. Chromium delivers
 * both as `wheel` events with `ctrlKey` set, whose default action is native page
 * zoom -- that would fight the CSS `zoom` shell (see MainWindow /
 * OnboardingZoomRoot). `preventDefault` (non-passive + capture, so it lands
 * before the zoom happens) suppresses it and we scale {@link zoomAtom} instead,
 * so wheel/pinch zoom uses the identical clamped mechanism as the menu
 * accelerators.
 *
 * Bails over the file viewer's image panzoom surface, which runs its own
 * wheel zoom and already prevents native zoom there, so app zoom doesn't
 * double-fire on top of it.
 */
export function useZoomWheel() {
  const setZoom = useSetAtom(zoomAtom);

  useEffect(() => {
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(`.${IMAGE_PANZOOM_VIEWPORT_CLASS}`)
      ) {
        return;
      }
      event.preventDefault();
      const deltaPx = normalizeWheelDeltaPx(event);
      setZoom((z) =>
        clampZoom(z * Math.exp(-deltaPx * ZOOM_WHEEL_SENSITIVITY)),
      );
    }

    window.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [setZoom]);
}
