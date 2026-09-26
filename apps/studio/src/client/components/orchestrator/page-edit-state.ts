import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useRef } from "react";

/**
 * Which page tabs are in Edit, where the View / Edit control is drawn, and
 * the ⌘E chord's way to the tab on screen; see `page-edit.tsx`.
 */

/** The page tabs in Edit, by tab id. Not kept across launches: every page opens as a page. */
export const pageEditTabsAtom = atom<Record<string, true>>({});

/**
 * Where the View / Edit control is drawn, while both are being tried: in the
 * row above the page beside its reload and menu, or as a pill floating over
 * the page's foot that becomes the edit toolbar.
 */
export type PageEditPlacement = "pill" | "row";

export const pageEditPlacementAtom = atomWithStorage<PageEditPlacement>(
  "orchestrator.pageEditPlacement.v1",
  "row",
  undefined,
  { getOnInit: true },
);

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
