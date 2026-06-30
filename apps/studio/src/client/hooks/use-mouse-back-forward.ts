import { tabsAtom } from "@/client/atoms/tabs";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { useStore } from "jotai";
import { useEffect } from "react";

// Mouse thumb-button (back/forward) navigation. On main each tab was its own
// WebContentsView, so Chromium navigated that tab's history natively. The
// unified app is one web contents with per-tab memory-history routers, so we
// capture buttons 3/4 ourselves and drive the active tab's router. Capture phase
// + preventDefault/stopPropagation so the buttons can't also register as clicks.
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

    window.addEventListener("mousedown", onMouseDown, { capture: true });
    return () => {
      window.removeEventListener("mousedown", onMouseDown, { capture: true });
    };
  }, [store]);
}
