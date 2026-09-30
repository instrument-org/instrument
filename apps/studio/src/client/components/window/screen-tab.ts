import { type ScreenView } from "@/client/atoms/window";
import { createContext, useContext } from "react";

/**
 * The tab a screen is drawn in, when that is not the window's own tab on
 * screen: a draft's band, or a popped-out chat grown with a thing up. The
 * window's router follows only its own tab, so a screen drawn anywhere else
 * moves its tab, leaves it, and says what it shows through this instead.
 * Absent, a screen is the window's and uses the router and the window's
 * screen view, as the pane beside a chat does.
 */
export interface ScreenTab {
  id: string;
  /** Steps the tab back along its trail, or closes it when it has nowhere to go. */
  leave: () => void;
  /** What the tab shows, as the conversation is told it; null clears it. */
  report: (view: null | ScreenView) => void;
  /** Sends the tab to another address in place. */
  visit: (href: string) => void;
}

export const ScreenTabContext = createContext<null | ScreenTab>(null);

export function useScreenTab(): null | ScreenTab {
  return useContext(ScreenTabContext);
}
