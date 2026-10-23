import { registerFindTarget } from "@/client/lib/find-targets";
import { type RefObject, useEffect, useRef } from "react";

/**
 * Makes the search behind `openFind` the one Cmd+F opens while the keyboard is
 * in this surface (the nearest `[data-find-surface]` around `anchor`), or was
 * last; see find-targets for the whole rule. `enabled: false` takes it out,
 * for a surface that is mounted but should not answer (a page under an
 * overlay).
 */
export function useFindTarget({
  anchor,
  enabled = true,
  findAgain,
  holdsKeyboard,
  openFind,
}: {
  anchor: RefObject<Element | null>;
  enabled?: boolean;
  findAgain?: (forward: boolean) => void;
  holdsKeyboard?: () => boolean;
  openFind: () => void;
}) {
  const latest = useRef({ findAgain, holdsKeyboard, openFind });
  latest.current = { findAgain, holdsKeyboard, openFind };
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return registerFindTarget({
      anchor: () => anchor.current,
      findAgain: (forward) => {
        if (latest.current.findAgain) {
          latest.current.findAgain(forward);
        } else {
          latest.current.openFind();
        }
      },
      holdsKeyboard: () => latest.current.holdsKeyboard?.() ?? false,
      openFind: () => {
        latest.current.openFind();
      },
    });
  }, [anchor, enabled]);
}
