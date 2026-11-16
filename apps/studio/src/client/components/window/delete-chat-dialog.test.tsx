import { renderWithProviders } from "@/tests/render";
import { type ChatId } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { type Chat } from "./chats";
import { DeleteChatDialog } from "./delete-chat-dialog";

const { trash } = vi.hoisted(() => ({
  trash: vi.fn<(input: { id: string }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        live: {
          rows: {
            call: () => new Promise(() => undefined),
          },
          tasks: {
            experimental_liveOptions: () => ({
              queryFn: () => Promise.resolve([]),
              queryKey: ["tasks"],
            }),
          },
        },
        session: { queryKey: () => ["session"] },
        trash: { call: trash },
      },
    },
  },
}));

const CHAT = {
  id: "2026-10-16-quiet-dishwashers" as ChatId,
  title: "Quiet dishwashers under $900",
} as Chat;

function openDialog() {
  return renderWithProviders(
    <DeleteChatDialog
      chat={CHAT}
      onDeleted={() => undefined}
      onOpenChange={() => undefined}
      open
    />,
  );
}

beforeEach(() => {
  trash.mockReset();
  trash.mockResolvedValue(undefined);
});

// Unmounting the dialog's focus scope dispatches an event on a zero timeout.
// Let it fire while this file's jsdom is still up, or it lands in the next
// file's window and throws there as an uncaught error.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("deleting a chat", () => {
  it("moves the chat to the trash", async () => {
    openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));

    await waitFor(() => {
      expect(trash).toHaveBeenCalledWith({ id: CHAT.id });
    });
  });
});
