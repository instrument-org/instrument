import { type TabId, TabIdSchema } from "@/shared/tabs";
import { createContext, type ReactNode, useContext } from "react";

const ActiveTabContext = createContext<boolean>(true);

// Sentinel for code that reads a tab id outside any tab (e.g. a prompt surface
// mounted in the chrome). Keyed distinctly so its atom-family state never
// collides with a real tab's.
const NO_TAB_ID = TabIdSchema.parse("$$no-tab$$");
const TabIdContext = createContext<TabId>(NO_TAB_ID);

/**
 * Provided by each `TabView` so anything inside a tab can tell whether it is the
 * foreground tab. Every tab stays mounted (hidden via CSS `visibility`), so
 * components that drive out-of-tree resources (e.g. the body-mounted agent
 * browser `<webview>`) can't rely on their own DOM visibility and need this.
 */
export function ActiveTabProvider({
  children,
  isActive,
}: {
  children: ReactNode;
  isActive: boolean;
}) {
  return <ActiveTabContext value={isActive}>{children}</ActiveTabContext>;
}

/**
 * Provided by each `TabView` so tab-scoped state (e.g. a compose draft) can be
 * keyed by the owning tab rather than by shared page identity.
 */
export function TabIdProvider({
  children,
  id,
}: {
  children: ReactNode;
  id: TabId;
}) {
  return <TabIdContext value={id}>{children}</TabIdContext>;
}

// Defaults to true outside the tab host so non-tab contexts behave as active.
// eslint-disable-next-line react-refresh/only-export-components
export function useIsActiveTab() {
  return useContext(ActiveTabContext);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTabId() {
  return useContext(TabIdContext);
}
