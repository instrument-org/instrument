import {
  type ScreenView,
  screenViewsAtom,
  walkedFoldersAtom,
} from "@/client/atoms/window";
import { useTabId } from "@/client/hooks/use-active-tab";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { useGroupTab } from "./group-tab";

/**
 * Says what this screen has on it, for as long as it is up, under the tab it
 * is drawn in: a group's tab beside a chat or in a draft's band, or one of
 * the window's own. The layout reads the tab in view when a message is sent,
 * so the conversation is told about what is on screen and never about a
 * screen the user left.
 *
 * Null registers nothing and clears nothing: a layout route with a child
 * screen inside it passes null so the child's answer stands.
 */
export function useOnScreen(view: null | ScreenView) {
  const setViews = useSetAtom(screenViewsAtom);
  const groupTabId = useGroupTab()?.id;
  const appTabId = useTabId();
  const key = groupTabId ?? appTabId;
  // By value: the screens build a fresh object each render.
  const said = JSON.stringify(view);
  useEffect(() => {
    if (view === null) {
      return;
    }
    setViews((current) => ({ ...current, [key]: view }));
    return () => {
      // Only its own answer is cleared, so a screen arriving in the same tab
      // as this one leaves is not cleared with it.
      setViews((current) => {
        if (current[key] !== view) {
          return current;
        }
        const { [key]: _gone, ...rest } = current;
        return rest;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [said, key, setViews]);
}

/**
 * Says where the folder on this screen was walked to, under the same tab as
 * `useOnScreen`, for the location bar. Null registers nothing.
 */
export function useWalkedFolder(
  folder: null | { hostPath: string; walked: string },
) {
  const setWalked = useSetAtom(walkedFoldersAtom);
  const groupTabId = useGroupTab()?.id;
  const appTabId = useTabId();
  const key = groupTabId ?? appTabId;
  // By value: the screen builds a fresh object each render.
  const said = JSON.stringify(folder);
  useEffect(() => {
    if (folder === null) {
      return;
    }
    setWalked((current) => ({ ...current, [key]: folder }));
    return () => {
      setWalked((current) => {
        if (current[key] !== folder) {
          return current;
        }
        const { [key]: _gone, ...rest } = current;
        return rest;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [said, key, setWalked]);
}
