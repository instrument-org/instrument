import { reportDialogAtom } from "@/client/atoms/report-dialog";
import { renderWithDefaultStore } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolOfferFeedback } from "./tool-offer-feedback";

const mocks = vi.hoisted(() => ({
  setOfferFeedback: vi.fn<(input: { enabled: boolean }) => Promise<void>>(),
  settle: vi.fn<(input: { outcome: string }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    problems: {
      setOfferFeedback: {
        mutationOptions: (options: object) => ({
          ...options,
          mutationFn: mocks.setOfferFeedback,
        }),
      },
    },
    workspace: {
      chats: {
        settleFeedbackOffer: {
          mutationOptions: (options: object) => ({
            ...options,
            mutationFn: mocks.settle,
          }),
        },
      },
    },
  },
}));

const chatId = ChatIdSchema.parse("2026-10-27-pricing");
const input = {
  title: "Zendesk's page crashed the browser tab three times in a row",
  reason: "Other sites loaded fine, so this looks like a bug in Instrument.",
  writeup: "The tab crashed each of three times.",
};

const part = (output: unknown) =>
  ({
    input,
    metadata: {
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    output,
    state: "output-available",
    toolCallId: "call-1",
    type: "tool-offer_feedback",
  }) as unknown as Parameters<typeof ToolOfferFeedback>[0]["part"];

beforeEach(() => {
  mocks.setOfferFeedback.mockReset().mockResolvedValue();
  mocks.settle.mockReset().mockResolvedValue();
  getDefaultStore().set(reportDialogAtom, null);
});

describe("ToolOfferFeedback", () => {
  it("draws nothing for an offer the app refused", () => {
    const { container } = renderWithDefaultStore(
      <ToolOfferFeedback
        chatId={chatId}
        part={part({ offered: false, reason: "recent" })}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("opens the feedback dialog with the agent's write-up", () => {
    renderWithDefaultStore(
      <ToolOfferFeedback chatId={chatId} part={part({ offered: true })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review and send" }));
    expect(getDefaultStore().get(reportDialogAtom)).toMatchObject({
      chatId,
      kind: "feedback",
      surface: "agent-offer",
      writeup: { text: input.writeup, title: input.title },
    });
  });

  it("puts the offer away, and stops the offers when asked", async () => {
    renderWithDefaultStore(
      <ToolOfferFeedback chatId={chatId} part={part({ offered: true })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Don’t offer again" }));
    await waitFor(() => {
      expect(mocks.settle).toHaveBeenCalled();
    });
    expect(mocks.settle.mock.calls[0]?.[0]).toMatchObject({
      outcome: "dismissed",
    });
    expect(mocks.setOfferFeedback.mock.calls[0]?.[0]).toEqual({
      enabled: false,
    });
  });

  it("says it was sent once it was", () => {
    renderWithDefaultStore(
      <ToolOfferFeedback
        chatId={chatId}
        part={part({ offered: true, outcome: "sent" })}
      />,
    );
    expect(screen.getByText("Sent to the Instrument team")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
