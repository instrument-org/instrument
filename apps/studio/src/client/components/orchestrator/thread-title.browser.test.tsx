import { renderInBrowser } from "@/tests/render-browser";
import { StoreId, TaskIdSchema } from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { OrchestratorContext } from "./context";
import { ThreadTitle } from "./thread-title";
import { type Thread } from "./threads";
import { useThreadRename } from "./use-thread-rename";

const calls = vi.hoisted(() => ({
  rename: vi.fn(),
  /** Settled by the test, so the sparkle can be seen at work. */
  retitle: vi.fn<() => Promise<{ title?: string }>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      orchestrator: {
        threads: {
          rename: {
            mutationOptions: (options: object) => ({
              ...options,
              mutationFn: (input: unknown) => {
                calls.rename(input);
                return Promise.resolve();
              },
            }),
          },
          retitle: {
            mutationOptions: (options: object) => ({
              ...options,
              mutationFn: () => calls.retitle(),
            }),
          },
        },
      },
    },
  },
}));

const taskId = TaskIdSchema.parse("orchestrator");
const sessionId = StoreId.newSessionId();
const TITLE = "Grocery list for the week";

async function renderTitle() {
  await renderInBrowser(
    <OrchestratorContext
      value={{
        ask: vi.fn(),
        browser: null,
        focusComposer: vi.fn(),
        openPage: vi.fn(),
        openPath: vi.fn(),
        openScreen: vi.fn(),
        opensNewTab: true,
        taskId,
      }}
    >
      <Title />
    </OrchestratorContext>,
  );
}

function thread(): Thread {
  const messageId = StoreId.newMessageId();
  const at = new Date(2026, 8, 16, 9, 0);
  return {
    archived: false,
    createdAt: at.getTime(),
    holds: { apps: [], files: [], sites: [] },
    id: sessionId,
    replyCount: 1,
    root: {
      id: messageId,
      metadata: { createdAt: at, sessionId },
      parts: [
        {
          metadata: {
            createdAt: at,
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text: "make me a grocery list",
          type: "text",
        },
      ],
      role: "user",
    },
    runningTasks: [],
    starred: false,
    state: "idle",
    title: TITLE,
    titled: true,
    topics: [],
    unread: 0,
    updatedAt: at.getTime(),
  };
}

function Title() {
  const rename = useThreadRename(thread());
  return <ThreadTitle className="text-sm" rename={rename} title={TITLE} />;
}

describe("ThreadTitle", () => {
  beforeEach(() => {
    calls.rename.mockClear();
  });

  it("opens a field on a click and saves what the user typed on Enter", async () => {
    await renderTitle();
    await userEvent.click(page.getByRole("button", { name: TITLE }));
    const field = page.getByRole("textbox");
    await expect.element(field).toHaveFocus();

    await userEvent.fill(field, "Weekly shop");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(calls.rename).toHaveBeenCalledWith({
        id: taskId,
        sessionId,
        title: "Weekly shop",
      });
    });
  });

  it("names the thread from the sparkle inside the field, keeping the field open until it has", async () => {
    let answer: ((value: { title?: string }) => void) | undefined;
    calls.retitle.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await renderTitle();
    await userEvent.click(page.getByRole("button", { name: TITLE }));
    await userEvent.click(
      page.getByRole("button", { name: "Name it from the conversation" }),
    );

    await expect.element(page.getByRole("status")).toBeVisible();
    await expect.element(page.getByRole("textbox")).toHaveFocus();
    expect(calls.rename).not.toHaveBeenCalled();

    answer?.({ title: "Weekly grocery shop" });
    await expect
      .element(page.getByRole("button", { name: TITLE }))
      .toBeVisible();
  });
});
