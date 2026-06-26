import { SingleTabOnlyRoutes, type Tab } from "@/shared/tabs";

/**
 * Renderer-owned tab state and the pure transitions over it. This replaces the
 * main-process `TabsManager` bookkeeping (selection, ordering, reopen-closed,
 * single-tab-route dedup) so the whole shell can live in one web contents.
 *
 * Every function is pure: it returns a new model and never mutates the input,
 * so it is trivially unit-testable and safe to drive a Jotai atom.
 */
export interface TabsModel {
  recentlyClosed: Tab[];
  selectedId: null | string;
  tabs: Tab[];
}

const MAX_RECENTLY_CLOSED = 10;

export function addTab(
  model: TabsModel,
  {
    iconName,
    id,
    pathname,
    select = true,
    title,
  }: {
    iconName?: Tab["iconName"];
    id: string;
    pathname: string;
    select?: boolean;
    title?: string;
  },
): TabsModel {
  // Single-tab routes collapse onto the existing tab instead of duplicating.
  if (isSingleTabRoute(pathname)) {
    const existing = findByBasePath(model, pathname);
    if (existing) {
      return { ...model, selectedId: existing.id };
    }
  }

  const tab: Tab = { iconName, id, pathname, pinned: false, title };
  return {
    ...model,
    selectedId: select ? id : model.selectedId,
    tabs: [...model.tabs, tab],
  };
}

export function closeTab(
  model: TabsModel,
  {
    id,
    newTab,
  }: {
    id: string;
    /** Used to seed a fresh tab when the last one is closed. */
    newTab: { id: string; pathname: string };
  },
): TabsModel {
  const tab = model.tabs.find((t) => t.id === id);
  if (!tab || tab.pinned) {
    return model;
  }

  const snapshot = visibleTabs(model);
  const closingIndex = snapshot.findIndex((t) => t.id === id);

  const tabs = model.tabs.filter((t) => t.id !== id);
  const recentlyClosed = [tab, ...model.recentlyClosed].slice(
    0,
    MAX_RECENTLY_CLOSED,
  );

  if (tabs.length === 0) {
    return {
      recentlyClosed,
      selectedId: newTab.id,
      tabs: [{ id: newTab.id, pathname: newTab.pathname, pinned: false }],
    };
  }

  const selectedId =
    model.selectedId === id
      ? neighborId(snapshot, closingIndex)
      : model.selectedId;

  return { recentlyClosed, selectedId, tabs };
}

export function emptyTabsModel(): TabsModel {
  return { recentlyClosed: [], selectedId: null, tabs: [] };
}

/**
 * Reflect a client-side navigation of the selected tab. A navigation to a
 * single-tab route that already has a tab collapses onto it rather than
 * pointing two tabs at the same task.
 */
export function navigate(
  model: TabsModel,
  { pathname }: { pathname: string },
): TabsModel {
  if (isSingleTabRoute(pathname)) {
    const existing = findByBasePath(model, pathname);
    if (existing && existing.id !== model.selectedId) {
      return { ...model, selectedId: existing.id };
    }
  }
  return {
    ...model,
    tabs: model.tabs.map((tab) =>
      tab.id === model.selectedId ? { ...tab, pathname } : tab,
    ),
  };
}

export function reopenClosed(
  model: TabsModel,
  { id }: { id: string },
): TabsModel {
  const [restored, ...rest] = model.recentlyClosed;
  if (!restored) {
    return model;
  }
  return addTab(
    { ...model, recentlyClosed: rest },
    {
      iconName: restored.iconName,
      id,
      pathname: restored.pathname,
      title: restored.title,
    },
  );
}

export function reorderTabs(
  model: TabsModel,
  { ids }: { ids: string[] },
): TabsModel {
  const pinned = model.tabs.filter((tab) => tab.pinned);
  const byId = new Map(model.tabs.map((tab) => [tab.id, tab]));
  const reordered = ids
    .map((id) => byId.get(id))
    .filter((tab): tab is Tab => tab !== undefined && !tab.pinned);
  return { ...model, tabs: [...pinned, ...reordered] };
}

export function selectAdjacent(
  model: TabsModel,
  { delta }: { delta: number },
): TabsModel {
  const visible = visibleTabs(model);
  if (visible.length <= 1) {
    return model;
  }
  const current = visible.findIndex((tab) => tab.id === model.selectedId);
  const next = (current + delta + visible.length) % visible.length;
  const tab = visible[next];
  return tab ? { ...model, selectedId: tab.id } : model;
}

export function selectByIndex(
  model: TabsModel,
  { index }: { index: number },
): TabsModel {
  const tab = visibleTabs(model)[index];
  return tab ? { ...model, selectedId: tab.id } : model;
}

export function selectTab(model: TabsModel, { id }: { id: string }): TabsModel {
  if (!model.tabs.some((tab) => tab.id === id)) {
    return model;
  }
  return { ...model, selectedId: id };
}

export function setTabMeta(
  model: TabsModel,
  {
    iconName,
    id,
    taskId,
    title,
  }: {
    iconName?: Tab["iconName"];
    id: string;
    taskId?: Tab["taskId"];
    title?: string;
  },
): TabsModel {
  return {
    ...model,
    tabs: model.tabs.map((tab) =>
      tab.id === id
        ? {
            ...tab,
            iconName: iconName ?? tab.iconName,
            taskId: taskId ?? tab.taskId,
            title: title ?? tab.title,
          }
        : tab,
    ),
  };
}

/** Mirror a per-tab router navigation back into the model (drives the tab bar). */
export function setTabPathname(
  model: TabsModel,
  { id, pathname }: { id: string; pathname: string },
): TabsModel {
  return {
    ...model,
    tabs: model.tabs.map((tab) => (tab.id === id ? { ...tab, pathname } : tab)),
  };
}

function basePath(pathname: string) {
  return pathname.split("?")[0];
}

function findByBasePath(model: TabsModel, pathname: string) {
  const target = basePath(pathname);
  return model.tabs.find((tab) => basePath(tab.pathname) === target);
}

/** Routes that may only ever have a single tab open (e.g. a specific task). */
function isSingleTabRoute(pathname: string) {
  return SingleTabOnlyRoutes.test(pathname);
}

/**
 * Selects the neighbor of `closing` among the pre-removal visible snapshot:
 * prefers the tab to the right, falls back to the left.
 */
function neighborId(visibleSnapshot: Tab[], closingIndex: number) {
  const next =
    visibleSnapshot[closingIndex + 1] ?? visibleSnapshot[closingIndex - 1];
  return next?.id ?? null;
}

function visibleTabs(model: TabsModel) {
  return model.tabs.filter((tab) => !tab.tabBarHidden);
}
