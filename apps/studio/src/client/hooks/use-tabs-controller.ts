import { tabsAtom } from "@/client/atoms/tabs";
import {
  addTab,
  closeTab,
  navigate,
  reopenClosed,
  reorderTabs,
  selectAdjacent,
  selectByIndex,
  selectTab,
  setTabMeta,
  setTabPathname,
  type TabsModel,
} from "@/client/lib/tab-model";
import { getTabHistory } from "@/client/lib/tab-router-registry";
import { type Tab } from "@/shared/tabs";
import { useAtom } from "jotai";
import { startTransition } from "react";

const NEW_TAB_PATH = "/new-tab";

/**
 * Renderer-side tab actions backed by the pure {@link TabsModel}. Tab state
 * lives entirely in the renderer; nothing round-trips to the main process.
 */
export function useTabsController() {
  const [model, setModel] = useAtom(tabsAtom);

  // A transition, not an urgent update: switching/opening a tab can mount a
  // whole new router tree (see MainWindow's TabView), and marking it low-priority
  // lets React keep the outgoing tab interactive while the next one prepares,
  // and lets a later switch interrupt a still-in-flight one instead of stacking.
  const update = (fn: (model: TabsModel) => TabsModel) => {
    startTransition(() => {
      setModel(fn);
    });
  };

  return {
    addTab: ({
      iconName,
      pathname,
      select,
      title,
    }: {
      iconName?: Tab["iconName"];
      pathname: string;
      select?: boolean;
      title?: string;
    }) => {
      update((m) =>
        addTab(m, { iconName, id: freshId(), pathname, select, title }),
      );
    },
    closeTab: ({ id }: { id: string }) => {
      update((m) =>
        closeTab(m, {
          history: getTabHistory(id),
          id,
          newTab: { id: freshId(), pathname: NEW_TAB_PATH },
        }),
      );
    },
    model,
    navigate: ({ pathname }: { pathname: string }) => {
      update((m) => navigate(m, { pathname }));
    },
    reopenClosed: () => {
      update((m) => reopenClosed(m, { id: freshId() }));
    },
    reorderTabs: ({ ids }: { ids: string[] }) => {
      update((m) => reorderTabs(m, { ids }));
    },
    selectAdjacent: ({ delta }: { delta: number }) => {
      update((m) => selectAdjacent(m, { delta }));
    },
    selectByIndex: ({ index }: { index: number }) => {
      update((m) => selectByIndex(m, { index }));
    },
    selectTab: ({ id }: { id: string }) => {
      update((m) => selectTab(m, { id }));
    },
    setTabMeta: (args: {
      iconName?: Tab["iconName"];
      id: string;
      taskId?: Tab["taskId"];
      title?: string;
    }) => {
      update((m) => setTabMeta(m, args));
    },
    setTabPathname: ({ id, pathname }: { id: string; pathname: string }) => {
      update((m) => setTabPathname(m, { id, pathname }));
    },
  };
}

function freshId() {
  return crypto.randomUUID();
}
