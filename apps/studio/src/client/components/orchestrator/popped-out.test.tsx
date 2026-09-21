import { renderWithProviders } from "@/tests/render";
import { StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PoppedOut } from "./popped-out";
import { type Thread } from "./threads";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    archived: false,
    createdAt: 1,
    holds: { apps: [], files: [], sites: [] },
    id: StoreId.SessionSchema.parse("ses_01J8ZZZZZZZZZZZZZZZZZZZZZ1"),
    replyCount: 1,
    root: { parts: [{ text: "Find a filter", type: "text" }] },
    runningTasks: [],
    starred: false,
    state: "idle",
    title: "Replacement filter for the Levoit",
    titled: true,
    topics: [],
    unread: 0,
    updatedAt: 1,
    ...overrides,
  } as Thread;
}

describe("PoppedOut", () => {
  it("says the conversation is in the corner and offers the way back", () => {
    const onBringBack = vi.fn();
    renderWithProviders(
      <PoppedOut onBringBack={onBringBack} thread={thread()} />,
    );
    expect(screen.getByText("Popped out")).toBeTruthy();
    expect(screen.getByText("The conversation is in the corner.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bring back" }));
    expect(onBringBack).toHaveBeenCalledOnce();
  });

  it("carries the thread's work line while a task runs", () => {
    renderWithProviders(
      <PoppedOut
        onBringBack={vi.fn()}
        thread={thread({
          runningTasks: [
            {
              id: "task-1",
              step: "Comparing the price at Target",
              title: "Compare prices",
            },
          ] as Thread["runningTasks"],
          state: "working",
        })}
      />,
    );
    expect(screen.getByText("Comparing the price at Target")).toBeTruthy();
    expect(screen.queryByText("The conversation is in the corner.")).toBeNull();
  });
});
