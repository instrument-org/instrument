import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTaskList, type TaskListItem } from "./chat-task-list";

const { stopSessions } = vi.hoisted(() => ({
  stopSessions: vi.fn<(input: { id: string }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      session: {
        stop: {
          mutationOptions: () => ({ mutationFn: stopSessions }),
        },
      },
    },
  },
}));

const CHAT_ID = ChatIdSchema.parse("2026-10-05-lisbon-trip");

function item(
  title: string,
  overrides: Partial<Omit<TaskListItem, "id">> = {},
): TaskListItem {
  return {
    id: StoreId.newSessionId(),
    line: "Working",
    standing: "done",
    stoppable: false,
    title,
    updatedAt: new Date(0),
    ...overrides,
  };
}

const WORKING = item("lisbon-hotel", { standing: "running", stoppable: true });
const HELD = item("porto-train", { standing: "waiting", stoppable: true });
const IDLE = item("madrid-flight");

function renderList(items: TaskListItem[]) {
  const onOpen = vi.fn();
  renderWithProviders(
    <ChatTaskList chat={CHAT_ID} items={items} onOpen={onOpen} />,
  );
  return { onOpen };
}

describe("ChatTaskList", () => {
  beforeEach(() => {
    stopSessions.mockReset();
    stopSessions.mockResolvedValue(undefined);
  });

  it("stops every working or held task and leaves idle ones alone", async () => {
    renderList([WORKING, HELD, IDLE]);

    fireEvent.click(
      screen.getByRole("button", { name: "Stop all working tasks" }),
    );

    await waitFor(() => {
      expect(stopSessions).toHaveBeenCalledTimes(2);
    });
    const stopped = stopSessions.mock.calls.map(([input]) => input);
    expect(stopped).toEqual(
      expect.arrayContaining([
        { id: CHAT_ID, sessionId: WORKING.id },
        { id: CHAT_ID, sessionId: HELD.id },
      ]),
    );
    expect(stopped).not.toContainEqual({ id: CHAT_ID, sessionId: IDLE.id });
  });

  it("offers no stop while nothing listed is working", () => {
    renderList([IDLE]);

    expect(
      screen.queryByRole("button", { name: "Stop all working tasks" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop this task" })).toBeNull();
  });

  it("stops a row's task without opening it", async () => {
    const { onOpen } = renderList([WORKING, IDLE]);

    fireEvent.click(screen.getByRole("button", { name: "Stop this task" }));

    await waitFor(() => {
      expect(stopSessions).toHaveBeenCalledTimes(1);
    });
    expect(stopSessions.mock.calls[0]?.[0]).toEqual({
      id: CHAT_ID,
      sessionId: WORKING.id,
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
