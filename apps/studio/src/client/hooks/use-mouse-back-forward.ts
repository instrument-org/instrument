import { tabsAtom } from "@/client/atoms/tabs";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { useStore } from "jotai";
import { useEffect } from "react";

// Mouse thumb-button (back/forward) navigation. The app is one web contents
// with per-tab memory-history routers, so Chromium has no per-tab history to
// navigate natively; capture buttons 3/4 and drive the active tab's router.
// Capture phase + preventDefault/stopPropagation so the buttons can't also
// register as clicks.
export function useMouseBackForward() {
  const store = useStore();

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const router = getTabRouter(store.get(tabsAtom).selectedId);
      if (event.button === 3) {
        router?.history.back();
      } else {
        router?.history.forward();
      }
    };

    // Also suppress the default nav on mouseup/auxclick: Chromium can fire its
    // native BrowserBack/BrowserForward at those stages, so preventing it on
    // mousedown alone isn't always enough.
    const onAux = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("mousedown", onMouseDown, { capture: true });
    window.addEventListener("mouseup", onAux, { capture: true });
    window.addEventListener("auxclick", onAux, { capture: true });
    return () => {
      window.removeEventListener("mousedown", onMouseDown, { capture: true });
      window.removeEventListener("mouseup", onAux, { capture: true });
      window.removeEventListener("auxclick", onAux, { capture: true });
    };
  }, [store]);
}
