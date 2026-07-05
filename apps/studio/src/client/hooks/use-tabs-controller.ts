import { tabsAtom } from "@/client/atoms/tabs";
import { closeTabById, openTab } from "@/client/lib/tab-actions";
import { reorderTabs, selectTab, type TabsModel } from "@/client/lib/tab-model";
import { type Tab } from "@/shared/tabs";
import { useAtom } from "jotai";
import { startTransition } from "react";

/**
 * Renderer-side tab actions backed by the pure {@link TabsModel}. Tab state
 * lives entirely in the renderer; nothing round-trips to the main process.
 * Dispatches through the shared {@link tab-actions} builders (also used by the
 * app-command stream) so both paths open/close tabs identically.
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
      update((m) => openTab(m, { iconName, pathname, select, title }));
    },
    closeTab: ({ id }: { id: string }) => {
      update((m) => closeTabById(m, { id }));
    },
    model,
    reorderTabs: ({ ids }: { ids: string[] }) => {
      update((m) => reorderTabs(m, { ids }));
    },
    selectTab: ({ id }: { id: string }) => {
      update((m) => selectTab(m, { id }));
    },
  };
}
