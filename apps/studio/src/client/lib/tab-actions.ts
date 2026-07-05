import {
  addTab,
  closeTab,
  reopenClosed,
  type TabsModel,
} from "@/client/lib/tabs-model";
import { type Tab, type TabId, TabIdSchema } from "@/shared/tabs";

/**
 * Impure model actions shared by the two dispatchers that mutate the tabs atom:
 * the UI controller ({@link useTabsController}, which wraps these in a
 * transition) and the main-process app-command stream ({@link useAppCommands},
 * which calls them bare). Each bakes in id generation and the new-tab seed so
 * "open a tab" / "close the current tab" means the same thing on both paths.
 *
 * The pure transitions in {@link tabs-model} stay id-injecting and side-effect
 * free; this is the one layer that reaches for a fresh id.
 */
export const NEW_TAB_PATH = "/new-tab";

export function closeSelectedTab(model: TabsModel): TabsModel {
  return model.selectedId
    ? closeTabById(model, { id: model.selectedId })
    : model;
}

export function closeTabById(
  model: TabsModel,
  { id }: { id: TabId },
): TabsModel {
  return closeTab(model, {
    id,
    newTab: { id: freshTabId(), pathname: NEW_TAB_PATH },
  });
}

export function freshTabId(): TabId {
  return TabIdSchema.parse(crypto.randomUUID());
}

export function openTab(
  model: TabsModel,
  {
    iconName,
    pathname,
    select,
    title,
  }: {
    iconName?: Tab["iconName"];
    pathname: string;
    select?: boolean;
    title?: string;
  },
): TabsModel {
  return addTab(model, { iconName, id: freshTabId(), pathname, select, title });
}

export function reopenTab(model: TabsModel): TabsModel {
  return reopenClosed(model, { id: freshTabId() });
}
