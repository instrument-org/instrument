import { type Tab, type TabId, TabIdSchema, TabSchema } from "@/shared/tabs";
import { z } from "zod";

/**
 * Renderer-owned tab state and the pure transitions over it: selection,
 * ordering, reopen-closed, single-tab-route dedupe. Lets the whole app window
 * live in one web contents.
 *
 * Every function is pure: it returns a new model and never mutates the input,
 * so it is trivially unit-testable and safe to drive a Jotai atom.
 */
/** A closed tab, with where it stood in the strip so a reopen puts it back there. */
const ClosedTabSchema = TabSchema.extend({ index: z.number().optional() });
export type ClosedTab = z.output<typeof ClosedTabSchema>;

export const TabsModelSchema = z.object({
  recentlyClosed: z.array(ClosedTabSchema),
  selectedId: TabIdSchema.nullable(),
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
    id: TabId;
    pathname: string;
    select?: boolean;
    title?: string;
  },
): TabsModel {
  // Any route may have multiple tabs open at once (e.g. two tabs of the same
  // project/task), like a browser. No single-tab collapsing.
  const tab: Tab = { history, iconName, id, pathname, title };
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
    id: TabId;
    /** Used to seed a fresh tab when the last one is closed. */
    newTab: { id: TabId; pathname: string };
  },
): TabsModel {
  const tab = model.tabs.find((t) => t.id === id);
  if (!tab) {
    return model;
  }

  const closingIndex = model.tabs.findIndex((t) => t.id === id);

  const tabs = model.tabs.filter((t) => t.id !== id);
  // `tab.history` is already fresh: TabView captures each router's live stack on
  // every navigation (see setTabPathname), so reopen restores from the model
  // rather than a separate close-time snapshot.
  const recentlyClosed = [
    { ...tab, index: closingIndex },
    ...model.recentlyClosed,
  ].slice(0, MAX_RECENTLY_CLOSED);

  if (tabs.length === 0) {
    return {
      recentlyClosed,
      selectedId: newTab.id,
      tabs: [{ id: newTab.id, pathname: newTab.pathname }],
    };
  }

  const selectedId =
    model.selectedId === id
      ? neighborId(model.tabs, closingIndex)
      : model.selectedId;

  return { recentlyClosed, selectedId, tabs };
}

export function emptyTabsModel(): TabsModel {
  return { recentlyClosed: [], selectedId: null, tabs: [] };
}

/**
 * A closed tab back, up, at the place in the strip it was closed from, or at
 * the end of a strip that has since grown shorter than that. `entry` picks
 * one from the closed list, newest first; the newest when left out.
 */
export function reopenClosed(
  model: TabsModel,
  { entry = 0, id }: { entry?: number; id: TabId },
): TabsModel {
  const restored = model.recentlyClosed[entry];
  if (!restored) {
    return model;
  }
  const tab: Tab = {
    history: restored.history,
    iconName: restored.iconName,
    id,
    pathname: restored.pathname,
    title: restored.title,
  };
  const at = Math.min(
    Math.max(restored.index ?? model.tabs.length, 0),
    model.tabs.length,
  );
  return {
    recentlyClosed: model.recentlyClosed.filter((_, index) => index !== entry),
    selectedId: id,
    tabs: [...model.tabs.slice(0, at), tab, ...model.tabs.slice(at)],
  };
}

export function reorderTabs(
  model: TabsModel,
  { ids }: { ids: TabId[] },
): TabsModel {
  const byId = new Map(model.tabs.map((tab) => [tab.id, tab]));
  const reordered = ids
    .map((id) => byId.get(id))
    .filter((tab): tab is Tab => tab !== undefined);
  return { ...model, tabs: reordered };
}

export function selectAdjacent(
  model: TabsModel,
  { delta }: { delta: number },
): TabsModel {
  if (model.tabs.length <= 1) {
    return model;
  }
  const current = model.tabs.findIndex((tab) => tab.id === model.selectedId);
  const next = (current + delta + model.tabs.length) % model.tabs.length;
  const tab = model.tabs[next];
  return tab ? { ...model, selectedId: tab.id } : model;
}

export function selectByIndex(
  model: TabsModel,
  { index }: { index: number },
): TabsModel {
  const tab = model.tabs[index];
  return tab ? { ...model, selectedId: tab.id } : model;
}

export function selectTab(model: TabsModel, { id }: { id: TabId }): TabsModel {
  if (!model.tabs.some((tab) => tab.id === id)) {
    return model;
  }
  return { ...model, selectedId: id };
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
  }: { history?: Tab["history"]; id: TabId; pathname: string },
): TabsModel {
  return {
    ...model,
    tabs: model.tabs.map((tab) =>
      tab.id === id ? { ...tab, history, pathname } : tab,
    ),
  };
}

/**
 * Selects the neighbor of `closing` among the pre-removal tabs: prefers the tab
 * to the right, falls back to the left.
 */
function neighborId(tabs: Tab[], closingIndex: number) {
  const next = tabs[closingIndex + 1] ?? tabs[closingIndex - 1];
  return next?.id ?? null;
}
