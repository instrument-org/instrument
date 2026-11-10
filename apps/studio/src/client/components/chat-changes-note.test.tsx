import { renderWithProviders } from "@/tests/render";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatChangesNote } from "./chat-changes-note";

const { chats, undoChanges } = vi.hoisted(() => ({
  chats: [] as Record<string, unknown>[],
  undoChanges: vi.fn(),
}));

vi.mock("./window/chat-list-query", () => ({
  chatListOptions: () => ({
    queryFn: () => chats,
    queryKey: ["chat-list"],
  }),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: { undoChanges: { call: undoChanges } },
      projects: {
        list: {
          queryOptions: () => ({
            queryFn: () => [
              { color: "#9b8af0", id: "prj_travel", name: "Travel" },
            ],
            queryKey: ["projects"],
          }),
        },
      },
    },
  },
}));

const chat = (name: string) => ChatIdSchema.parse(name);

beforeEach(() => {
  chats.length = 0;
  undoChanges.mockReset();
});

describe("ChatChangesNote", () => {
  it("names what was done and lists each chat with its changes", async () => {
    chats.push(
      {
        archived: false,
        id: "a",
        project: "prj_travel",
        starred: false,
        title: "Douro Valley day trip",
      },
      {
        archived: true,
        id: "b",
        starred: false,
        title: "Weeknight grocery list",
      },
    );
    renderWithProviders(
      <ChatChangesNote
        changes={[
          {
            after: "Douro Valley day trip",
            before: "Porto trip",
            chat: chat("a"),
            field: "title",
          },
          {
            after: "prj_travel",
            before: null,
            chat: chat("a"),
            field: "project",
          },
          { after: true, before: false, chat: chat("b"), field: "archived" },
        ]}
      />,
    );

    expect(await screen.findByText("Organized 2 chats")).toBeDefined();
    expect(screen.getByText("Douro Valley day trip")).toBeDefined();
    expect(screen.getByText("“Porto trip”")).toBeDefined();
    expect(await screen.findByText("Travel")).toBeDefined();
    expect(screen.getByText("Archived")).toBeDefined();
  });

  it("shows five chats and the rest behind Show more", async () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    chats.push(
      ...names.map((id) => ({
        archived: true,
        id,
        starred: false,
        title: `Chat ${id}`,
      })),
    );
    renderWithProviders(
      <ChatChangesNote
        changes={names.map((id) => ({
          after: true,
          before: false,
          chat: chat(id),
          field: "archived" as const,
        }))}
      />,
    );

    expect(await screen.findByText("Archived 7 chats")).toBeDefined();
    expect(screen.queryByText("Chat f")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getByText("Chat g")).toBeDefined();
  });

  it("says Undone in place of Undo once the changes are put back", async () => {
    chats.push({ archived: true, id: "a", starred: false, title: "Espresso" });
    undoChanges.mockResolvedValue({ skipped: 0, undone: 1 });
    renderWithProviders(
      <ChatChangesNote
        changes={[
          { after: true, before: false, chat: chat("a"), field: "archived" },
        ]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Undone")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says Undone for a card undone on another device or before a reload", async () => {
    chats.push({ archived: false, id: "a", starred: false, title: "Espresso" });
    renderWithProviders(
      <ChatChangesNote
        changes={[
          { after: true, before: false, chat: chat("a"), field: "archived" },
        ]}
        undone
      />,
    );

    expect(await screen.findByText("Undone")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
