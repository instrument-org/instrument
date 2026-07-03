import { type Tab, TabSchema } from "@/shared/tabs";
import { z } from "zod";

/**
 * Renderer-owned tab state and the pure transitions over it: selection,
 * ordering, reopen-closed, single-tab-route dedupe. Lets the whole shell live
 * in one web contents.
 *
 * Every function is pure: it returns a new model and never mutates the input,
 * so it is trivially unit-testable and safe to drive a Jotai atom.
 */
export const TabsModelSchema = z.object({
  recentlyClosed: z.array(TabSchema),
  selectedId: z.string().nullable(),
  tabs: z.array(TabSchema),
});
export type TabsModel = z.output<typeof TabsModelSchema>;

const MAX_RECENTLY_CLOSED = 10;

export function addTab(
  model: TabsModel,
  {
    history,
    iconName,
    id,
    pathname,
    select = true,
    title,
  }: {
    history?: Tab["history"];
    iconName?: Tab["iconName"];
    id: string;
    pathname: string;
    select?: boolean;
    title?: string;
  },
): TabsModel {
  // Any route may have multiple tabs open at once (e.g. two tabs of the same
  // project/task), like a browser. No single-tab collapsing.
  const tab: Tab = { history, iconName, id, pathname, pinned: false, title };
  return {
    ...model,
    selectedId: select ? id : model.selectedId,
    tabs: [...model.tabs, tab],
  };
}

export function closeTab(
  model: TabsModel,
  {
    history,
    id,
    newTab,
  }: {
    /** The closing tab's live history stack, restored if it's reopened. */
    history?: Tab["history"];
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
  const recentlyClosed = [
    history ? { ...tab, history } : tab,
    ...model.recentlyClosed,
  ].slice(0, MAX_RECENTLY_CLOSED);

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

/** Reflect a client-side navigation of the selected tab into the model. */
export function navigate(
  model: TabsModel,
  { pathname }: { pathname: string },
): TabsModel {
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
      history: restored.history,
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

/**
 * Apply the resolved head meta of a tab's route to the model. The caller always
 * passes the full snapshot for the deepest match, so this replaces rather than
 * merges: a route that declares no icon (e.g. a task, which uses its status
 * ring) clears an icon left over from the previous route (e.g. a project).
 */
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
      tab.id === id ? { ...tab, iconName, taskId, title } : tab,
    ),
  };
}

/**
 * Mirror a per-tab router navigation back into the model (drives the tab bar).
 * Also captures the router's live back/forward stack so persistence always
 * serializes a fresh history: without this the only history a tab ever carries
 * is a reopen-time seed that goes stale the moment the tab navigates again.
 */
export function setTabPathname(
  model: TabsModel,
  {
    history,
    id,
    pathname,
  }: { history?: Tab["history"]; id: string; pathname: string },
): TabsModel {
  return {
    ...model,
    tabs: model.tabs.map((tab) =>
      tab.id === id ? { ...tab, history, pathname } : tab,
    ),
  };
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
