import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StopTurnButton } from "./stop-turn-button";

const { alive, stopSessions } = vi.hoisted(() => ({
  alive: { value: false },
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

// Whether the chat's own session has a live agent, which is what the
// machine reports and a test has none of.
vi.mock("@/client/hooks/use-agent-session-status", () => ({
  useAgentSessionStatus: () => ({
    isAgentAlive: alive.value,
    isAgentRunning: alive.value,
  }),
}));

const CHAT_ID = ChatIdSchema.parse("2026-10-13-documents");
const SESSION = StoreId.newSessionId();

describe("StopTurnButton", () => {
  beforeEach(() => {
    stopSessions.mockReset();
    stopSessions.mockResolvedValue(undefined);
  });

  it("stops the chat's own turn alone while it runs, whatever its tasks do", async () => {
    alive.value = true;
    renderWithProviders(
      <StopTurnButton chatId={CHAT_ID} sessionId={SESSION} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(stopSessions).toHaveBeenCalledWith(
        { id: CHAT_ID, sessionId: SESSION },
        expect.anything(),
      );
    });
  });

  it("is not there while the chat's own turn is not running", () => {
    alive.value = false;
    renderWithProviders(
      <StopTurnButton chatId={CHAT_ID} sessionId={SESSION} />,
    );
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
