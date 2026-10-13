import { registerFindTarget } from "@/client/lib/find-targets";
import { type RefObject, useEffect, useRef } from "react";

/**
 * Makes the search behind `openFind` the one Cmd+F opens while the keyboard is
 * in this surface (the nearest `[data-find-surface]` around `anchor`), or was
 * last; see find-targets for the whole rule. `enabled: false` takes it out,
 * for a surface that is mounted but should not answer (a page parked under an
 * overlay).
 */
export function useFindTarget({
  anchor,
  enabled = true,
  holdsKeyboard,
  openFind,
}: {
  anchor: RefObject<Element | null>;
  enabled?: boolean;
  holdsKeyboard?: () => boolean;
  openFind: () => void;
}) {
  const latest = useRef({ holdsKeyboard, openFind });
  latest.current = { holdsKeyboard, openFind };
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return registerFindTarget({
      anchor: () => anchor.current,
      holdsKeyboard: () => latest.current.holdsKeyboard?.() ?? false,
      openFind: () => {
        latest.current.openFind();
      },
    });
  }, [anchor, enabled]);
}
