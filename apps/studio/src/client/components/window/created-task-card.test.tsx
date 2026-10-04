import { renderWithProviders } from "@/tests/render";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WindowContext } from "./context";
import { CreatedTaskCard } from "./created-task-card";

const { childrenOptions, childStatusOptions, stopSessions } = vi.hoisted(
  () => ({
    childrenOptions: vi.fn(),
    childStatusOptions: vi.fn(),
    stopSessions: vi.fn(),
  }),
);

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        live: { tasks: { experimental_liveOptions: childrenOptions } },
        taskStatus: { queryOptions: childStatusOptions },
      },
      session: {
        stop: {
          mutationOptions: () => ({ mutationFn: stopSessions }),
        },
      },
      // The task's record, which names the chat whose list it is read from.
      task: {
        byId: {
          queryOptions: () => ({
            queryFn: () =>
              Promise.resolve({
                id: "lisbon-hotel",
                chatId: "instrument",
              }),
            queryKey: ["task", "lisbon-hotel"],
          }),
        },
      },
    },
  },
}));

// The gestures that open the task in a tab of its own reach the window's
// browser and the OS menu; a plain click is the card's own and is all this
// test drives.
vi.mock("@/client/hooks/use-open-target", () => ({
  useOpenGestures: () => ({
    onAuxClick: vi.fn(),
    onContextMenu: vi.fn(),
    separate: undefined,
  }),
}));

const CHAT_ID = TaskIdSchema.parse("instrument");
const TASK_ID = "lisbon-hotel";

function renderCard() {
  const openScreen = vi.fn();
  renderWithProviders(
    <WindowContext
      value={{
        ask: vi.fn(),
        browser: null,
        focusComposer: vi.fn(),
        openPage: vi.fn(),
        openPath: vi.fn(),
        openScreen,
      }}
    >
      <CreatedTaskCard taskId={TASK_ID} />
    </WindowContext>,
  );
  return { openScreen };
}

/** The card once the task has stopped working, with the line the task list would say about it. */
function renderFinished(standing: {
  kind: "done" | "failed" | "waiting";
  line: string;
}) {
  childStatusOptions.mockReturnValue({
    queryFn: () =>
      Promise.resolve({
        isWorking: false,
        title: "Lisbon hotel",
        updatedAt: 0,
      }),
    queryKey: ["childStatus", TASK_ID],
  });
  childrenOptions.mockReturnValue({
    queryFn: () => Promise.resolve([{ id: TASK_ID, standing }]),
    queryKey: ["children", CHAT_ID],
  });
  return renderCard();
}

/** The card while the task is held from starting. */
function renderHeld(held: string) {
  childStatusOptions.mockReturnValue({
    queryFn: () =>
      Promise.resolve({
        held,
        isWorking: false,
        title: "Tidy the Desktop",
        updatedAt: 0,
      }),
    queryKey: ["childStatus", TASK_ID],
  });
  childrenOptions.mockReturnValue({
    queryFn: () => Promise.resolve([]),
    queryKey: ["children", CHAT_ID],
  });
  return renderCard();
}

/** The card while the task is at a step. */
function renderWorking(step: string) {
  childStatusOptions.mockReturnValue({
    queryFn: () =>
      Promise.resolve({
        isWorking: true,
        step,
        title: "Lisbon hotel",
        updatedAt: 0,
      }),
    queryKey: ["childStatus", TASK_ID],
  });
  childrenOptions.mockReturnValue({
    queryFn: () => Promise.resolve([]),
    queryKey: ["children", CHAT_ID],
  });
  return renderCard();
}

describe("CreatedTaskCard", () => {
  it("reads as the task's name and then its line, and opens the task in place", async () => {
    const { openScreen } = renderFinished({
      kind: "done",
      line: "Wrote hotel-options.md with three places near the Alfama.",
    });

    const row = await screen.findByRole("button", {
      name: "Lisbon hotel · Wrote hotel-options.md with three places near the Alfama.",
    });
    expect(
      screen.getByText(
        "Wrote hotel-options.md with three places near the Alfama.",
      ).className,
    ).not.toContain("text-warning");

    fireEvent.click(row);

    expect(openScreen).toHaveBeenCalledWith("/tasks/lisbon-hotel");
  });

  it.each([
    { kind: "failed" as const, line: "The model returned an error" },
    { kind: "waiting" as const, line: "Waiting for you to answer" },
  ])("says a $kind task's line in the warning tone", async ({ kind, line }) => {
    renderFinished({ kind, line });

    const said = await screen.findByText(line);
    expect(said.className).toContain("text-warning-700");
  });

  it("offers a stop beside a working task that halts it without opening it", async () => {
    const { openScreen } = renderWorking("Comparing prices");

    fireEvent.click(
      await screen.findByRole("button", { name: "Stop this task" }),
    );

    await vi.waitFor(() => {
      expect(stopSessions).toHaveBeenCalledWith(
        { id: "lisbon-hotel" },
        expect.anything(),
      );
    });
    expect(openScreen).not.toHaveBeenCalled();
  });

  it("offers no stop once the task is done", async () => {
    renderFinished({ kind: "done", line: "Wrote hotel-options.md." });

    await screen.findByText("Wrote hotel-options.md.");
    expect(screen.queryByRole("button", { name: "Stop this task" })).toBeNull();
  });

  it("says what a held task waits on, in the warning tone, with a stop that cancels it", async () => {
    renderHeld("Waiting for you to allow access to Desktop");

    const said = await screen.findByText(
      "Waiting for you to allow access to Desktop",
    );
    expect(said.className).toContain("text-warning-700");

    fireEvent.click(screen.getByRole("button", { name: "Stop this task" }));

    await vi.waitFor(() => {
      expect(stopSessions).toHaveBeenCalledWith(
        { id: "lisbon-hotel" },
        expect.anything(),
      );
    });
  });
});
