import { TaskIdSchema } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  getTaskIndicatorClearDelay,
  VIEW_CLEAR_DELAY_MS,
} from "./task-indicator-clear-delay";

const taskA = TaskIdSchema.parse("task-a");
const taskB = TaskIdSchema.parse("task-b");

// Baseline: an unread automatic mark on the foreground tab, sitting on the task
// (no arrival -- same id and already active last render). Each case overrides the
// fields it exercises.
const sittingOnTask: Parameters<typeof getTaskIndicatorClearDelay>[0] = {
  currentId: taskA,
  isActiveTab: true,
  isManual: false,
  isUnread: true,
  previousId: taskA,
  wasActive: true,
};

describe("getTaskIndicatorClearDelay", () => {
  it.each([
    {
      expected: null,
      name: "leaves a task that is not unread",
      state: { ...sittingOnTask, isUnread: false },
    },
    {
      expected: null,
      name: "leaves an unread task that is not the foreground tab",
      state: { ...sittingOnTask, isActiveTab: false },
    },
    {
      // The reported bug: a task finishing under your eyes must not dwell as a dot.
      expected: 0,
      name: "clears an automatic mark immediately when it finishes while you sit on it",
      state: sittingOnTask,
    },
    {
      expected: VIEW_CLEAR_DELAY_MS,
      name: "debounces an automatic mark you arrive at by regaining the foreground",
      state: { ...sittingOnTask, wasActive: false },
    },
    {
      expected: VIEW_CLEAR_DELAY_MS,
      name: "debounces an automatic mark on a fresh mount onto the task",
      state: { ...sittingOnTask, previousId: null, wasActive: null },
    },
    {
      expected: VIEW_CLEAR_DELAY_MS,
      name: "debounces an automatic mark you navigate to within the same tab",
      state: { ...sittingOnTask, previousId: taskB },
    },
    {
      // The manual "mark as unread" behavior: it must survive the dwell it was set in.
      expected: null,
      name: "holds a manual mark set while sitting on the task",
      state: { ...sittingOnTask, isManual: true },
    },
    {
      expected: VIEW_CLEAR_DELAY_MS,
      name: "clears a manual mark when you leave and return via the foreground",
      state: { ...sittingOnTask, isManual: true, wasActive: false },
    },
    {
      // Same-tab A->B->A: the id changing is the only arrival signal available.
      expected: VIEW_CLEAR_DELAY_MS,
      name: "clears a manual mark when you return via same-tab navigation",
      state: { ...sittingOnTask, isManual: true, previousId: taskB },
    },
    {
      expected: VIEW_CLEAR_DELAY_MS,
      name: "clears a manual mark on a fresh mount onto the task",
      state: {
        ...sittingOnTask,
        isManual: true,
        previousId: null,
        wasActive: null,
      },
    },
  ])("$name", ({ expected, state }) => {
    expect(getTaskIndicatorClearDelay(state)).toBe(expected);
  });
});
