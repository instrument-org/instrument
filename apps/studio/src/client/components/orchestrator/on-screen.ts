import { type ScreenView, screenViewAtom } from "@/client/atoms/orchestrator";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

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
  // By value: the screens build a fresh object each render.
  const key = JSON.stringify(view);
  useEffect(() => {
    if (view === null) {
      return;
    }
    setView(view);
    return () => {
      // Only its own answer is cleared, so a screen arriving as this one
      // leaves is not cleared with it.
      setView((current) => (current === view ? null : current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setView]);
}
