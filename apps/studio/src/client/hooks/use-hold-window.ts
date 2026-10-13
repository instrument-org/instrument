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
  {
    ancestors,
    back = true,
    key,
    onClose,
  }: {
    ancestors?: readonly object[];
    back?: boolean;
    key?: object;
    onClose?: () => boolean | void;
  } = {},
) {
  const store = useStore();
  const latest = useRef(onClose);
  const latestAncestors = useRef(ancestors);
  useEffect(() => {
    latest.current = onClose;
    latestAncestors.current = ancestors;
  });
  const canClose = onClose !== undefined;
  useEffect(() => {
    if (!active) {
      return;
    }
    const hold = {
      key,
      ancestors: latestAncestors.current,
      ...(canClose
        ? {
            close: () => {
              return latest.current?.();
            },
          }
        : {}),
    };
    store.set(windowHoldsAtom, (holds) => {
      // A nested dialog can mount before its parent effect registers.
      const child =
        key === undefined
          ? -1
          : holds.findIndex((other) => other.ancestors?.includes(key));
      return child === -1
        ? [...holds, hold]
        : [...holds.slice(0, child), hold, ...holds.slice(child)];
    });
    return () => {
      store.set(windowHoldsAtom, (holds) =>
        holds.filter((other) => other !== hold),
      );
    };
  }, [active, canClose, key, store]);
  useModalBack(
    () => {
      latest.current?.();
    },
    active && canClose && back,
  );
}
