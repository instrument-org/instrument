import { type TabsModel } from "@/client/lib/tabs-model";
import { type TabId } from "@/shared/tabs";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";

export type FocusTaskPlan =
  | { tabId: TabId; type: "navigateSelectedTab" }
  | { tabId: TabId; type: "navigateTaskTab" }
  | { tabId: TabId; type: "selectTaskTab" };

export function planFocusTask({
  model,
  readSelectedSessionId,
  sessionId,
  taskId,
}: {
  model: TabsModel;
  readSelectedSessionId: (tabId: TabId) => StoreId.Session | undefined;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): FocusTaskPlan | undefined {
  const taskTabs = model.tabs.filter((tab) => tab.taskId === taskId);
  const selectedTaskTab = taskTabs.find((tab) => tab.id === model.selectedId);
  const exactTab =
    selectedTaskTab && readSelectedSessionId(selectedTaskTab.id) === sessionId
      ? selectedTaskTab
      : taskTabs.find((tab) => readSelectedSessionId(tab.id) === sessionId);
  if (exactTab) {
    return { tabId: exactTab.id, type: "selectTaskTab" };
  }

  const taskTab = selectedTaskTab ?? taskTabs[0];
  if (taskTab) {
    return { tabId: taskTab.id, type: "navigateTaskTab" };
  }

  return model.selectedId
    ? { tabId: model.selectedId, type: "navigateSelectedTab" }
    : undefined;
}
