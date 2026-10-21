import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChatTasksPopover } from "./chat-activity";

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

vi.mock("@/client/hooks/use-task-background-processes", () => ({
  useTaskBackgroundProcesses: () => [],
}));

// The steps themselves are the transcript's, tested with it; the card only
// says which session it shows.
vi.mock("./child-tasks", () => ({
  ChildTranscript: ({ sessionId }: { sessionId: string }) => (
    <p>Steps of {sessionId}</p>
  ),
}));

vi.mock("@/client/hooks/use-developer-mode", () => ({
  useTabDeveloperMode: () => false,
}));

const chatSession = StoreId.newSessionId();

const { stopSessions } = vi.hoisted(() => ({
  stopSessions:
    vi.fn<(input: { id: string; sessionId?: string }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        session: {
          queryOptions: () => ({
            queryFn: () => ({ sessionId: chatSession }),
            queryKey: ["chat-session"],
          }),
        },
      },
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

/** The chat's task list, hanging from a plain trigger as the line under its title hangs it. */
function tasksList({
  onOpen = vi.fn(),
  running = RUNNING,
}: { onOpen?: () => void; running?: typeof RUNNING } = {}) {
  return renderInBrowser(
    <ChatTasksPopover
      chatId={CHAT_ID}
      onOpen={onOpen}
      own={{ line: "Planning the trip", title: "Lisbon trip", working: true }}
      tasks={running}
      trigger={<button type="button">Tasks</button>}
    />,
  );
}

const openList = () =>
  userEvent.click(page.getByRole("button", { name: "Tasks" }));

describe("ChatTasksPopover", () => {
  it("lists the chat first and shows the steps of the task pressed", async () => {
    const onOpen = vi.fn();
    await tasksList({ onOpen });
    await openList();
    await expect.element(page.getByText("This chat")).toBeVisible();
    await expect.element(page.getByText("Running")).toBeVisible();
    await expect.element(page.getByText("Finished")).toBeVisible();
    await expect.element(page.getByText("Pastel de nata shops")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /Packing list/ }));
    await expect.element(page.getByText(`Steps of ${packing}`)).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith(packing);
  });

  it("opens straight onto the chat's own steps when it has no task", async () => {
    listed.tasks = [];
    await tasksList({ running: [] });
    await openList();
    await expect
      .element(page.getByText(`Steps of ${chatSession}`))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "All tasks" }))
      .not.toBeInTheDocument();
  });

  it("stops one working task from its row, and offers no stop on a finished one", async () => {
    const onOpen = vi.fn();
    await tasksList({ onOpen });
    await openList();
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
    await tasksList();
    await openList();
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
    await tasksList({ running: [] });
    await openList();
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

  it.each([
    ["person", "You stopped this task"],
    ["agent", "The chat stopped this task"],
  ] as const)(
    "says the %s stopped a task, rather than drawing it done",
    async (stoppedBy, said) => {
      listed.tasks = [
        {
          ...PACKING,
          standing: { kind: "done", line: "Stopped while packing" },
          stoppedBy,
        },
      ];
      await tasksList({ running: [] });
      await openList();
      await expect.element(page.getByText(said)).toBeVisible();
    },
  );

  it("offers the finished tasks while nothing runs", async () => {
    listed.tasks = [PACKING];
    const onOpen = vi.fn();
    await tasksList({ onOpen, running: [] });
    await openList();
    await expect.element(page.getByText("Running")).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: /Packing list/ }));
    await expect.element(page.getByText(`Steps of ${packing}`)).toBeVisible();
    expect(onOpen).not.toHaveBeenCalled();
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
    await tasksList({ running: [] });
    await openList();
    await expect
      .element(page.getByText("The app closed while counting the stops"))
      .toBeVisible();
    await expect
      .element(page.getByText("Made packing-list.md"))
      .not.toBeInTheDocument();
  });
});
