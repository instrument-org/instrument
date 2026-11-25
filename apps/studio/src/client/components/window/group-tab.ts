import { type ChatId } from "@instrument-org/workspace/client";
import { createContext, useContext } from "react";

import { type StepDirection } from "./tab-steps";

/**
 * The tab of a group a screen is drawn in (a chat's pane, a draft's band),
 * when that is not one of the window's own tabs. Such a screen moves by its own router, as every screen
 * does; this carries only what differs about standing in a group: how its
 * tab closes, and a page opened from it taking its place.
 */
export interface GroupTab {
  /** Closes the tab, for a screen with nowhere left to go. */
  close: () => void;
  /** The group the tab is in, for one of the window's groups. */
  group?: string;
  /** Whether the tab's side has the keyboard: the side a chat in it marks read from and takes the caret on. */
  hasKeyboard?: boolean;
  id: string;
  /** Whether the group's tab is on screen: false while the pane it is drawn in is put away, mounted but hidden. */
  isShown: boolean;
  /** A page in the tab's place: the web's start sending the tab to a site. */
  showPage: (url: string) => void;
  /** A step back or forward by the tab's own rule (`useTabSteps`), the one its row's arrows take: nothing where it has nowhere to go. */
  step: (direction: StepDirection) => void;
  /**
   * The chat whose versions of a file the tab's row lists, and which turns
   * into the version row while one is shown: set in a chat's pane.
   */
  versionsOf: ChatId | undefined;
}

export const GroupTabContext = createContext<GroupTab | null>(null);

/** The group's tab this screen is drawn in, or null for one of the window's own. */
export function useGroupTab(): GroupTab | null {
  return useContext(GroupTabContext);
}
