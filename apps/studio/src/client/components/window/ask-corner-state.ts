import { useEffect, useRef } from "react";

/** The ⌘J chord's way to the Ask corner of the tab group on screen; see `ask-corner.tsx`. */
let openOnScreen: (() => void) | null = null;

export function requestAskCorner() {
  openOnScreen?.();
}

/** Answers ⌘J while `open` is given: the corner on screen registers itself. */
export function useAskCornerRequest(open: (() => void) | null) {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  const isOn = open !== null;
  useEffect(() => {
    if (!isOn) {
      return;
    }
    const run = () => latest.current?.();
    openOnScreen = run;
    return () => {
      if (openOnScreen === run) {
        openOnScreen = null;
      }
    };
  }, [isOn]);
}
