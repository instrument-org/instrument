import { type ScreenView, screenViewAtom } from "@/client/atoms/orchestrator";
import { useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import { useScreenTab } from "./screen-tab";

/**
 * Says what this screen has on it, for as long as it is up. Every screen of
 * the window calls this with what it shows, and the layout sends the current
 * answer with each message, so the conversation is told about what is on
 * screen and never about a screen the user left.
 *
 * Null registers nothing and clears nothing: a layout route with a child
 * screen inside it passes null so the child's answer stands.
 */
export function useOnScreen(view: null | ScreenView) {
  const setView = useSetAtom(screenViewAtom);
  // A screen drawn in a tab of a draft or a popped-out chat says so to that
  // tab rather than to the window, whose screen it is not.
  const screenTab = useScreenTab();
  // Held by reference, so a host that makes its tab afresh each render does
  // not report again on every one: only the tab's id says it changed.
  const screenTabRef = useRef(screenTab);
  useEffect(() => {
    screenTabRef.current = screenTab;
  });
  const screenTabId = screenTab?.id;
  // By value: the screens build a fresh object each render.
  const key = JSON.stringify(view);
  useEffect(() => {
    if (view === null) {
      return;
    }
    const tab = screenTabRef.current;
    if (tab) {
      tab.report(view);
      return () => {
        tab.report(null);
      };
    }
    setView(view);
    return () => {
      // Only its own answer is cleared, so a screen arriving as this one
      // leaves is not cleared with it.
      setView((current) => (current === view ? null : current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setView, screenTabId]);
}
