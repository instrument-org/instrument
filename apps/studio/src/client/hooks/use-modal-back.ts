import { modalBackStackAtom } from "@/client/atoms/tab-navigation-block";
import { useStore } from "jotai";
import { useEffect, useRef } from "react";

/**
 * While `active`, a back press (thumb button, swipe, the History menu) runs
 * `onBack` instead of moving the tab behind. The latest registration wins, so
 * a page opened inside a modal steps back to the modal before the modal
 * closes. A modal with a history of its own passes `onForward` too, which a
 * forward press runs while this is the latest registration.
 */
export function useModalBack(
  onBack: () => void,
  active = true,
  onForward?: () => void,
) {
  const store = useStore();
  const latest = useRef({ onBack, onForward });
  useEffect(() => {
    latest.current = { onBack, onForward };
  });
  useEffect(() => {
    if (!active) {
      return;
    }
    const entry = {
      forward: () => {
        latest.current.onForward?.();
      },
      run: () => {
        latest.current.onBack();
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
