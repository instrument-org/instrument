import { atom, useAtom } from "jotai";
import { useEffect, useRef } from "react";

/**
 * Which page tabs are in Edit, and the ⌘E chord's way to the tab on screen;
 * see `page-edit.tsx`.
 */

/** The page tabs in Edit, by tab id. Not kept across launches: every page opens as a page. */
export const pageEditTabsAtom = atom<Record<string, true>>({});

/** The ⌘E chord, answered by whichever page tab is on screen. */
let toggleOnScreen: (() => void) | null = null;

export function requestPageEditToggle() {
  toggleOnScreen?.();
}

/** Whether a tab is in Edit, and the switch for it. */
export function usePageEdit(tabId: string) {
  const [tabs, setTabs] = useAtom(pageEditTabsAtom);
  const isEditing = tabs[tabId] === true;
  const setEditing = (next: boolean) => {
    setTabs((current) => {
      const { [tabId]: _was, ...rest } = current;
      return next ? { ...rest, [tabId]: true } : rest;
    });
  };
  return { isEditing, setEditing };
}

export function usePageEditToggleOnScreen(toggle: (() => void) | null) {
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });
  const isOn = toggle !== null;
  useEffect(() => {
    if (!isOn) {
      return;
    }
    const run = () => latest.current?.();
    toggleOnScreen = run;
    return () => {
      if (toggleOnScreen === run) {
        toggleOnScreen = null;
      }
    };
  }, [isOn]);
}
