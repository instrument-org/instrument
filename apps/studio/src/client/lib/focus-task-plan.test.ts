import { type TabsModel } from "@/client/lib/tabs-model";
import { type Tab, type TabId, TabIdSchema } from "@/shared/tabs";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { planFocusTask } from "./focus-task-plan";

const tabId = (value: string) => TabIdSchema.parse(value);
const taskId = TaskIdSchema.parse("task");
const sessionId = StoreId.newSessionId();

function model(tabs: Tab[], selectedId: TabId): TabsModel {
  return { recentlyClosed: [], selectedId, tabs };
}

function tab({
  id,
  taskId: idTask,
}: {
  id: string;
  taskId?: Tab["taskId"];
}): Tab {
  return { id: tabId(id), pathname: "/new-tab", taskId: idTask };
}

describe("planFocusTask", () => {
  it("selects an exact task session without navigating", () => {
    const exact = tab({ id: "exact", taskId });
    const other = tab({ id: "other" });

    expect(
      planFocusTask({
        model: model([other, exact], other.id),
        readSelectedSessionId: (id) =>
          id === exact.id ? sessionId : undefined,
        sessionId,
        taskId,
      }),
    ).toEqual({ tabId: exact.id, type: "selectTaskTab" });
  });

  it("prefers the selected tab when duplicate tabs show the same session", () => {
    const first = tab({ id: "first", taskId });
    const selected = tab({ id: "selected", taskId });

    expect(
      planFocusTask({
        model: model([first, selected], selected.id),
        readSelectedSessionId: () => sessionId,
        sessionId,
        taskId,
      }),
    ).toEqual({ tabId: selected.id, type: "selectTaskTab" });
  });

  it("reuses a task tab when it is showing another session", () => {
    const task = tab({ id: "task", taskId });

    expect(
      planFocusTask({
        model: model([task], task.id),
        readSelectedSessionId: () => StoreId.newSessionId(),
        sessionId,
        taskId,
      }),
    ).toEqual({ tabId: task.id, type: "navigateTaskTab" });
  });

  it("navigates the selected tab when the task is not open", () => {
    const selected = tab({ id: "selected" });
    const selectedSessions = new Map<TabId, StoreId.Session>();

    expect(
      planFocusTask({
        model: model([selected], selected.id),
        readSelectedSessionId: (id) => selectedSessions.get(id),
        sessionId,
        taskId,
      }),
    ).toEqual({ tabId: selected.id, type: "navigateSelectedTab" });
  });
});
