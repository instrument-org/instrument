import { IMAGE_PANZOOM_VIEWPORT_CLASS } from "@/client/hooks/use-image-panzoom";
import { useEffect } from "react";

/**
 * Suppresses Chromium's native ctrl+wheel and trackpad-pinch page zoom on the
 * app shell. Both gestures arrive as `wheel` events with `ctrlKey` set, and
 * their default action zooms the renderer's own contents -- which would fight
 * the CSS `zoom` shell (see MainWindow / OnboardingZoomRoot). App zoom is driven
 * only by the menu accelerators and the zoom widget, which step a discrete
 * ladder; a continuous wheel/pinch gesture would land between rungs, so we drop
 * it here rather than translate it into a zoom change.
 *
 * Bails over the file viewer's image panzoom surface, which runs its own wheel
 * zoom and prevents native zoom there itself.
 */
export function useSuppressWheelZoom() {
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
    }

    window.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, []);
}
