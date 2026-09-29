import { appTabsAtom } from "@/client/components/orchestrator/app-tabs";
import { freshTabId, openTab } from "@/client/lib/tab-actions";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { reopenClosed } from "@/client/lib/tabs-model";
import { getDefaultStore } from "jotai";

declare global {
  interface Window {
    __orchestratorDrive?: OrchestratorDrive;
  }
}

/**
 * What a driving script reaches in the 2.0 window: its tabs are routers of
 * their own, so an address goes to the tab up, or to a new tab, rather than
 * to the page's URL.
 */
interface OrchestratorDrive {
  goto: (href: string, options?: { newTab?: boolean }) => void;
  /** The tab closed last, back with its history, as Shift+Cmd+T brings it. */
  reopen: () => void;
  state: () => {
    path: null | string;
    tabs: { isSelected: boolean; pathname: string }[];
  };
}

/**
 * Hands the 2.0 window's tabs to `studio-drive`, for as long as the renderer
 * lives. Attached under `import.meta.env.DEV`, like the classic window's, so
 * a packaged build ships no remote control.
 */
export function initOrchestratorDrive() {
  if (!import.meta.env.DEV) {
    return;
  }
  const store = getDefaultStore();
  window.__orchestratorDrive = {
    goto: (href, options) => {
      if (options?.newTab) {
        store.set(appTabsAtom, (model) =>
          openTab(model, { pathname: href, select: true }),
        );
        return;
      }
      getTabRouter(store.get(appTabsAtom).selectedId)?.history.push(href);
    },
    reopen: () => {
      store.set(appTabsAtom, (model) =>
        reopenClosed(model, { id: freshTabId() }),
      );
    },
    state: () => {
      const model = store.get(appTabsAtom);
      return {
        path: getTabRouter(model.selectedId)?.history.location.href ?? null,
        tabs: model.tabs.map((tab) => ({
          isSelected: tab.id === model.selectedId,
          pathname: tab.pathname,
        })),
      };
    },
  };
}
