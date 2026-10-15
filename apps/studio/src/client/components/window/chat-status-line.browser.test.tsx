import { renderInBrowser } from "@/tests/render-browser";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChatStatusLine } from "./chat-status-line";

const CHAT_ID = ChatIdSchema.parse("2026-10-05-lisbon-trip");

vi.mock("./child-tasks-query", () => ({
  useChatTasks: () => ({ data: [] }),
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
});

const chat = (state: "idle" | "working") => ({
  id: CHAT_ID,
  lastUserMessageAt: 1,
  latest: { at: 2, kind: "step" as const, text: "Reading the fares" },
  lastStep: { at: 2, text: "Reading the fares" },
  runningTasks: [],
  state,
  title: "Lisbon trip",
});

describe("ChatStatusLine", () => {
  it("stops the whole chat from the dot while it works", async () => {
    await renderInBrowser(
      <ChatStatusLine chat={chat("working")} onOpenTask={vi.fn()} />,
    );
    await expect.element(page.getByText("Reading the fares")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Stop" }));
    await expect
      .poll(() => stopSessions.mock.calls[0]?.[0])
      .toEqual({ id: CHAT_ID });
  });

  it("offers no stop once the chat's work is done", async () => {
    await renderInBrowser(
      <ChatStatusLine chat={chat("idle")} onOpenTask={vi.fn()} />,
    );
    await expect.element(page.getByText("Done")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Stop" }))
      .not.toBeInTheDocument();
  });
});
