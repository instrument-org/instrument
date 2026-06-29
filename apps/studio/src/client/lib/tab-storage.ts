import { type TabsModel } from "@/client/lib/tab-model";
import { type Tab } from "@/shared/tabs";
import { TabIconsSchema } from "@instrument-org/shared/icons";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { z } from "zod";

const STORAGE_KEY = "studio.tabs.v1";

const TabSchema = z.object({
  iconName: TabIconsSchema.optional(),
  id: z.string(),
  pathname: z.string(),
  pinned: z.boolean().optional(),
  tabBarHidden: z.boolean().optional(),
  taskId: TaskIdSchema.optional(),
  title: z.string().optional(),
}) satisfies z.ZodType<Tab>;

const ModelSchema = z.object({
  recentlyClosed: z.array(TabSchema),
  selectedId: z.string().nullable(),
  tabs: z.array(TabSchema),
}) satisfies z.ZodType<TabsModel>;

/**
 * Tab state is persisted directly to localStorage (the main window's web
 * contents shares one origin, so it survives restarts) -- no main-process round
 * trip. Returns null when there's nothing valid to restore.
 */
export function loadTabsModel(): null | TabsModel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = ModelSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.tabs.length === 0) {
      return null;
    }
    const model = parsed.data;
    // Keep selection pointing at a tab that still exists.
    const selectedId = model.tabs.some((tab) => tab.id === model.selectedId)
      ? model.selectedId
      : (model.tabs[0]?.id ?? null);
    return { ...model, selectedId };
  } catch {
    return null;
  }
}

export function saveTabsModel(model: TabsModel) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    // Ignore quota / serialization failures; persistence is best-effort.
  }
}
