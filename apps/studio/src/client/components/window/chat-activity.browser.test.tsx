import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChatActivity } from "./chat-activity";

const CHAT_ID = ChatIdSchema.parse("2026-10-05-lisbon-trip");
const tram = StoreId.newSessionId();
const nata = StoreId.newSessionId();
const sintra = StoreId.newSessionId();
const packing = StoreId.newSessionId();

const RUNNING = [
  { id: tram, step: "Reading about tram 28's route", title: "Tram 28 history" },
  { id: nata, step: "Comparing reviews", title: "Pastel de nata shops" },
  { id: sintra, step: "Reading palace hours", title: "Sintra palaces" },
];

const PACKING = {
  id: packing,
  standing: { kind: "done", line: "Made packing-list.md" },
  title: "Packing list",
  updatedAt: new Date(2026, 9, 5, 14, 2),
};

/** What the chat's task list holds for the test running. */
const listed = vi.hoisted(() => ({ tasks: [] as unknown[] }));

vi.mock("./child-tasks-query", () => ({
  useChatTasks: () => ({ data: listed.tasks }),
}));

const { stopSessions } = vi.hoisted(() => ({
  stopSessions:
    vi.fn<(input: { id: string; sessionId?: string }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      session: {
        stop: { mutationOptions: () => ({ mutationFn: stopSessions }) },
      },
    },
  },
}));

beforeEach(() => {
  stopSessions.mockReset();
  stopSessions.mockResolvedValue(undefined);
  listed.tasks = [
    ...RUNNING.map((task, index) => ({
      id: task.id,
      standing: { kind: "running", line: task.step },
      stoppable: true,
      title: task.title,
      updatedAt: new Date(2026, 9, 5, 15, 10 - index),
    })),
    PACKING,
  ];
});

/** The activity in a head of the given width, the container its step is shown by. */
function inHead(width: number, onOpen = vi.fn()) {
  return renderInBrowser(
    <div className="@container/head flex justify-end" style={{ width }}>
      <ChatActivity chatId={CHAT_ID} onOpen={onOpen} tasks={RUNNING} />
    </div>,
  );
}

describe("ChatActivity", () => {
  it("shows the newest step in a wide head", async () => {
    await inHead(800);
    await expect
      .element(page.getByText("Reading about tram 28's route"))
      .toBeVisible();
  });

  it("folds to the dot alone in a narrow head", async () => {
    await inHead(300);
    await expect
      .element(page.getByText("Reading about tram 28's route"))
      .not.toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "3 tasks working" }))
      .toBeVisible();
  });

  it("lists running tasks, then finished ones, and opens the one pressed", async () => {
    const onOpen = vi.fn();
    await inHead(800, onOpen);
    await userEvent.click(
      page.getByRole("button", { name: "3 tasks working" }),
    );
    await expect.element(page.getByText("Running")).toBeVisible();
    await expect.element(page.getByText("Finished")).toBeVisible();
    await expect.element(page.getByText("Pastel de nata shops")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /Packing list/ }));
    expect(onOpen).toHaveBeenCalledWith(packing);
  });

  it("stops one working task from its row, and offers no stop on a finished one", async () => {
    const onOpen = vi.fn();
    await inHead(800, onOpen);
    await userEvent.click(
      page.getByRole("button", { name: "3 tasks working" }),
    );
    await expect
      .element(page.getByRole("button", { name: "Stop this task" }).nth(2))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Stop this task" }).nth(3))
      .not.toBeInTheDocument();
    await userEvent.click(
      page.getByRole("button", { name: "Stop this task" }).first(),
    );
    await expect
      .poll(() => stopSessions.mock.calls[0]?.[0])
      .toEqual({ id: CHAT_ID, sessionId: tram });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps every other task's stop while one task's stop is on its way", async () => {
    stopSessions.mockReturnValue(new Promise(() => {}));
    await inHead(800);
    await userEvent.click(
      page.getByRole("button", { name: "3 tasks working" }),
    );
    const stops = page.getByRole("button", { name: "Stop this task" });
    await userEvent.click(stops.first());
    await expect.element(stops.first()).toBeDisabled();
    await expect.element(stops.nth(1)).toBeEnabled();
  });

  // Its turn ended with a card still up: no agent is at work, but it waits
  // on the person, and its Stop takes it off the card.
  it("lists a task waiting on a card with what it waits for, and keeps its stop", async () => {
    listed.tasks = [
      {
        ...PACKING,
        standing: {
          kind: "waiting",
          line: "Waiting for your OK to use “Packing”",
        },
        stoppable: true,
        working: false,
      },
    ];
    await renderInBrowser(
      <ChatActivity chatId={CHAT_ID} onOpen={vi.fn()} tasks={[]} />,
    );
    await userEvent.click(page.getByRole("button", { name: "1 task" }));
    await expect.element(page.getByText("Running")).toBeVisible();
    await expect.element(page.getByText("Finished")).not.toBeInTheDocument();
    await expect
      .element(page.getByText("Waiting for your OK to use “Packing”"))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Stop this task" }));
    await expect
      .poll(() => stopSessions.mock.calls[0]?.[0])
      .toEqual({ id: CHAT_ID, sessionId: packing });
  });

  it("says the user stopped a task, rather than drawing it done", async () => {
    listed.tasks = [
      {
        ...PACKING,
        standing: { kind: "done", line: "Stopped while packing" },
        stoppedBy: "user",
      },
    ];
    await renderInBrowser(
      <ChatActivity chatId={CHAT_ID} onOpen={vi.fn()} tasks={[]} />,
    );
    await userEvent.click(page.getByRole("button", { name: "1 task" }));
    await expect.element(page.getByText("You stopped this task")).toBeVisible();
  });

  it("offers the finished tasks while nothing runs", async () => {
    listed.tasks = [PACKING];
    const onOpen = vi.fn();
    await renderInBrowser(
      <ChatActivity chatId={CHAT_ID} onOpen={onOpen} tasks={[]} />,
    );
    await userEvent.click(page.getByRole("button", { name: "1 task" }));
    await expect.element(page.getByText("Running")).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: /Packing list/ }));
    expect(onOpen).toHaveBeenCalledWith(packing);
  });

  it("says why a finished task failed, and nothing under one that is done", async () => {
    listed.tasks = [
      PACKING,
      {
        id: tram,
        standing: {
          kind: "failed",
          line: "The app closed while counting the stops",
        },
        title: "Tram 28 history",
        updatedAt: new Date(2026, 9, 5, 14, 30),
      },
    ];
    await renderInBrowser(
      <ChatActivity chatId={CHAT_ID} onOpen={vi.fn()} tasks={[]} />,
    );
    await userEvent.click(page.getByRole("button", { name: "2 tasks" }));
    await expect
      .element(page.getByText("The app closed while counting the stops"))
      .toBeVisible();
    await expect
      .element(page.getByText("Made packing-list.md"))
      .not.toBeInTheDocument();
  });

  it("draws nothing for a chat that filed no task", async () => {
    listed.tasks = [];
    const { container } = await renderInBrowser(
      <ChatActivity chatId={CHAT_ID} onOpen={vi.fn()} tasks={[]} />,
    );
    expect(container.textContent).toBe("");
  });
});
