import { type ScreenView } from "@/client/atoms/window";
import { createContext, useContext } from "react";

/**
 * The tab of a group a screen is drawn in (a chat's pane, a draft's band, a
 * popped-out chat grown with a thing up), when that is not one of the
 * window's own tabs. Such a screen moves by its own router, as every screen
 * does; this carries only what differs about standing in a group: how its
 * tab closes, what it shows told to the host, and a page opened from it
 * taking its place.
 */
export interface GroupTab {
  /** Closes the tab, for a screen with nowhere left to go. */
  close: () => void;
  id: string;
  /** What the tab shows, as the conversation is told it; null clears it. */
  report: (view: null | ScreenView) => void;
  /** A page in the tab's place: the web's start sending the tab to a site. */
  showPage: (url: string) => void;
}

export const GroupTabContext = createContext<GroupTab | null>(null);

/** The group's tab this screen is drawn in, or null for one of the window's own. */
export function useGroupTab(): GroupTab | null {
  return useContext(GroupTabContext);
}
