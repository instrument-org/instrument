import { reportDialogAtom } from "@/client/atoms/report-dialog";
import { renderWithDefaultStore } from "@/tests/render";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RatingCard } from "./rating-card";

const mocks = vi.hoisted(() => ({
  settle: vi.fn<(input: { outcome: string }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        settleRatingCard: {
          mutationOptions: (options: object) => ({
            ...options,
            mutationFn: mocks.settle,
          }),
        },
      },
    },
  },
}));

const chatId = ChatIdSchema.parse("2026-11-05-pricing");
const part = (outcome?: "dismissed" | "sent") =>
  ({
    data: { ...(outcome && { outcome }) },
    metadata: {
      createdAt: new Date(),
      id: StoreId.newPartId(),
      messageId: StoreId.newMessageId(),
      sessionId: StoreId.newSessionId(),
    },
    type: "data-ratingCard",
  }) as const;

beforeEach(() => {
  mocks.settle.mockReset().mockResolvedValue();
  getDefaultStore().set(reportDialogAtom, null);
});

describe("RatingCard", () => {
  it.each([
    ["Good", "good"],
    ["Fine", "okay"],
    ["Bad", "bad"],
  ])("opens the feedback dialog with %s's tag picked", (label, tag) => {
    renderWithDefaultStore(<RatingCard chatId={chatId} part={part()} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(getDefaultStore().get(reportDialogAtom)).toMatchObject({
      chatId,
      kind: "feedback",
      surface: "rating-card",
      tag,
    });
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("settles as sent only once the dialog has sent", async () => {
    renderWithDefaultStore(<RatingCard chatId={chatId} part={part()} />);
    fireEvent.click(screen.getByRole("button", { name: "Bad" }));
    const request = getDefaultStore().get(reportDialogAtom);
    request?.onSent?.();
    await waitFor(() => {
      expect(mocks.settle.mock.calls[0]?.[0]).toMatchObject({
        outcome: "sent",
      });
    });
  });

  it("closes as dismissed", async () => {
    renderWithDefaultStore(<RatingCard chatId={chatId} part={part()} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(mocks.settle.mock.calls[0]?.[0]).toMatchObject({
        outcome: "dismissed",
      });
    });
  });

  it("says it was sent, with nothing left to press", () => {
    renderWithDefaultStore(<RatingCard chatId={chatId} part={part("sent")} />);
    expect(screen.getByText("Sent to the Instrument team")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
