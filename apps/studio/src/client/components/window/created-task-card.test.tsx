import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WindowContext } from "./context";
import { CreatedTaskCard } from "./created-task-card";

const { childrenOptions, stopSessions } = vi.hoisted(() => ({
  childrenOptions: vi.fn(),
  stopSessions: vi.fn(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        live: { tasks: { experimental_liveOptions: childrenOptions } },
      },
      session: {
        stop: {
          mutationOptions: () => ({ mutationFn: stopSessions }),
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

const CHAT_ID = ChatIdSchema.parse("instrument");
const CHAT_SESSION = StoreId.newSessionId();
const TASK_ID = StoreId.newSessionId();

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
      {/* The chat's transcript, which the card is drawn in. */}
      <TaskSessionProvider sessionId={CHAT_SESSION} taskId={CHAT_ID}>
        <CreatedTaskCard taskId={TASK_ID} />
      </TaskSessionProvider>
    </WindowContext>,
  );
  return { openScreen };
}

/** The card once the task has stopped working, with the line the task list would say about it. */
function renderFinished(standing: {
  kind: "done" | "failed" | "waiting";
  line: string;
}) {
  childrenOptions.mockReturnValue({
    queryFn: () =>
      Promise.resolve([
        { id: TASK_ID, standing, stoppable: false, title: "Lisbon hotel" },
      ]),
    queryKey: ["children", CHAT_ID],
  });
  return renderCard();
}

/** The card while the task is at a step. */
function renderWorking(step: string) {
  childrenOptions.mockReturnValue({
    queryFn: () =>
      Promise.resolve([
        {
          id: TASK_ID,
          standing: { kind: "running", line: step },
          step,
          stoppable: true,
          title: "Lisbon hotel",
        },
      ]),
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

    expect(openScreen).toHaveBeenCalledWith(
      `/tasks/${TASK_ID}?chat=${CHAT_ID}`,
    );
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
        { id: CHAT_ID, sessionId: TASK_ID },
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
});
