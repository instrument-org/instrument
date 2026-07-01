import { blockingModalCountAtom } from "@/client/atoms/tab-navigation-block";
import { useStore } from "jotai";
import { useEffect } from "react";

/**
 * While mounted (and `active`), prevents tab navigation — `useTabCommands`
 * ignores tab open/close/switch shortcuts like Cmd+T / Cmd+W so the user can't
 * move out from under whatever is holding this. Composable and not modal-
 * specific: any component that should trap navigation can call it.
 *
 * Pass `active` when the caller stays mounted while closed (e.g. a controlled
 * `<Dialog open={open}>`); pass the dialog's `open`. Components that mount only
 * while open can take the default.
 */
export function useBlockTabNavigation(active = true) {
  const store = useStore();
  useEffect(() => {
    if (!active) {
      return;
    }
    store.set(blockingModalCountAtom, (count) => count + 1);
    return () => {
      store.set(blockingModalCountAtom, (count) => count - 1);
    };
  }, [active, store]);
}
