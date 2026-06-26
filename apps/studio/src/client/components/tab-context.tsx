import { createContext, useContext } from "react";

/**
 * The id of the tab a subtree belongs to. Provided by each `TabView` so per-tab
 * components (route meta, not-found, close-self) know which tab they are in,
 * replacing the old per-web-contents `window.api.tabId`.
 */
const TabContext = createContext<null | string>(null);

export const TabProvider = TabContext.Provider;

// eslint-disable-next-line react-refresh/only-export-components
export function useTabId() {
  return useContext(TabContext);
}
