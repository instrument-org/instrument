import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { atom, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

/**
 * Back and forward for the tab up, where what it shows has a history of its
 * own ahead of the tab's: a site at the window's level walks its page's
 * history first, and only from the page's start the tab's. The window's
 * arrows, its chords and the thumb buttons over the chrome all ask this
 * before the tab's router.
 */
type TabSteps = {
  back: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  forward: () => void;
};

/** What the tab up has registered, or nothing, where the tab's router is the whole of its history. */
export const tabStepsAtom = atom<null | TabSteps>(null);

/**
 * Registers what is drawn as the tab's steps while its tab is the one up;
 * `null` registers nothing. The functions are read at the moment of the
 * press, so a step always walks what is on screen then.
 */
export function useTabSteps(
  steps: null | {
    canGoBack: boolean;
    canGoForward: boolean;
    goBack: () => void;
    goForward: () => void;
  },
) {
  const isActive = useIsActiveTab();
  const setSteps = useSetAtom(tabStepsAtom);
  const latest = useRef(steps);
  useEffect(() => {
    latest.current = steps;
  });
  const isOn = steps !== null;
  const canGoBack = steps?.canGoBack ?? false;
  const canGoForward = steps?.canGoForward ?? false;
  useEffect(() => {
    if (!isActive || !isOn) {
      return;
    }
    const mine: TabSteps = {
      back: () => latest.current?.goBack(),
      canGoBack,
      canGoForward,
      forward: () => latest.current?.goForward(),
    };
    setSteps(mine);
    // Only its own registration is cleared, so the next tab's is not
    // cleared with it.
    return () => {
      setSteps((current) => (current === mine ? null : current));
    };
  }, [canGoBack, canGoForward, isActive, isOn, setSteps]);
}
