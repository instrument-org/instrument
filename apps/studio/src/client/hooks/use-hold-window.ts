import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { useStore } from "jotai";
import { useEffect, useRef } from "react";

/**
 * While `active`, holds the window over the tab behind it, the way anything
 * drawn over the whole window does (a dialog, a draft or a chat grown over
 * the row): the tab chords and history cannot move the tab behind, and back
 * and Cmd+W run `onClose`, the same way out the surface's own Escape and
 * close button take. Leave `onClose` out while the surface cannot be left
 * (a delete under way), and the chords simply wait.
 *
 * Pass `active` when the caller stays mounted while closed (a controlled
 * `<Dialog open={open}>`); components that mount only while open can take
 * the default.
 */
export function useHoldWindow(
  active = true,
  { onClose }: { onClose?: () => void } = {},
) {
  const store = useStore();
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  const canClose = onClose !== undefined;
  useEffect(() => {
    if (!active) {
      return;
    }
    const hold = canClose
      ? {
          close: () => {
            latest.current?.();
          },
        }
      : {};
    store.set(windowHoldsAtom, (holds) => [...holds, hold]);
    return () => {
      store.set(windowHoldsAtom, (holds) =>
        holds.filter((other) => other !== hold),
      );
    };
  }, [active, canClose, store]);
  useModalBack(() => {
    latest.current?.();
  }, active && canClose);
}
