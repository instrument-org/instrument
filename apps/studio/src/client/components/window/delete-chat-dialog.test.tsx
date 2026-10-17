import { renderWithProviders } from "@/tests/render";
import { type ChatId } from "@instrument-org/workspace/client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Chat } from "./chats";
import { DeleteChatDialog } from "./delete-chat-dialog";

const { trash } = vi.hoisted(() => ({
  trash: vi.fn<(input: { id: string; itsFolder?: boolean }) => Promise<void>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        live: {
          list: {
            experimental_liveOptions: () => ({ queryKey: ["chats"] }),
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

/** The box that takes the chat's own folder with it, by its label. */
function folderBox() {
  return screen.getByRole("checkbox", { name: "Delete its folder too" });
}

beforeEach(() => {
  trash.mockReset();
  trash.mockResolvedValue(undefined);
});

describe("deleting a chat", () => {
  it("leaves the chat's folder alone unless the person asks for it", async () => {
    openDialog();

    expect(folderBox().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));

    await waitFor(() => {
      expect(trash).toHaveBeenCalledWith({ id: CHAT.id, itsFolder: false });
    });
  });

  it("takes the folder too once the box is ticked", async () => {
    openDialog();

    fireEvent.click(folderBox());
    expect(folderBox().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));

    await waitFor(() => {
      expect(trash).toHaveBeenCalledWith({ id: CHAT.id, itsFolder: true });
    });
  });

  it("says what is in the folder, so the box is a choice and not a guess", () => {
    openDialog();

    expect(
      screen.getByText(
        "The transcript and anything the agent made for you are in there.",
      ).textContent,
    ).toBe("The transcript and anything the agent made for you are in there.");
  });
});
