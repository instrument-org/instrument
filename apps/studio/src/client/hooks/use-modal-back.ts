import { modalBackStackAtom } from "@/client/atoms/tab-navigation-block";
import { useStore } from "jotai";
import { useEffect, useRef } from "react";

/**
 * While `active`, a back press (thumb button, swipe, the History menu) runs
 * `onBack` instead of moving the tab behind. The latest registration wins, so
 * a page opened inside a modal steps back to the modal before the modal
 * closes.
 */
export function useModalBack(onBack: () => void, active = true) {
  const store = useStore();
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  useEffect(() => {
    if (!active) {
      return;
    }
    const entry = {
      run: () => {
        latest.current();
      },
    };
    store.set(modalBackStackAtom, (stack) => [...stack, entry]);
    return () => {
      store.set(modalBackStackAtom, (stack) =>
        stack.filter((other) => other !== entry),
      );
    };
  }, [active, store]);
}
