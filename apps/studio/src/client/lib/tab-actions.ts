import { addTab, type TabsModel } from "@/client/lib/tabs-model";
import { type Tab, type TabId, TabIdSchema } from "@/shared/tabs";

/**
 * The impure half of the tabs model: the pure transitions in
 * {@link tabs-model} stay id-injecting and side-effect free, and this is the
 * one layer that reaches for a fresh id.
 */
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
