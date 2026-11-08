import { renderWithProviders } from "@/tests/render";
import { useQuery } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        live: {
          list: {
            experimental_liveOptions: (options: object) => ({
              ...options,
              queryFn: () => new Promise(() => undefined),
              queryKey: ["chats", "live", "list"],
            }),
          },
        },
      },
    },
  },
}));

import { chatListOptions, chromeOfChats } from "./chat-list-query";
import { type Chat } from "./chats";

/** A row with what these readers look at; the rest of a wire row never reaches them. */
function row(id: string, overrides: Partial<Chat> = {}): Chat {
  // A partial row stands in for the whole: nothing here reads the rest.
  return {
    archived: false,
    id,
    status: "idle",
    title: id,
    unread: false,
    working: false,
    ...overrides,
  } as unknown as Chat;
}

const WRITING = { at: 1, kind: "reply", text: "Still writing" } as const;

const drawn = { chrome: vi.fn(), row: vi.fn() };
const renders = () => ({
  chrome: drawn.chrome.mock.calls.length,
  row: drawn.row.mock.calls.length,
});

// Each reads `data`, since a query draws its reader again only for the
// parts of its result the reader has read.
function Chrome() {
  const { data } = useQuery({ ...chatListOptions(), select: chromeOfChats });
  drawn.chrome();
  return <span>{data?.titles.length}</span>;
}

function Row({ id }: { id: string }) {
  const { data } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((chat) => chat.id === id),
  });
  drawn.row();
  return <span>{data?.title}</span>;
}

// Every answer arrives as a whole new list, each row a new object, as the
// wire delivers it.
describe("readers that select from the chat list", () => {
  it("draw again only for what they show", async () => {
    const { queryClient } = renderWithProviders(
      <>
        <Chrome />
        <Row id="a" />
      </>,
    );
    // A query tells its readers on the next tick.
    const answer = async (chats: Chat[]) => {
      await act(async () => {
        queryClient.setQueryData(chatListOptions().queryKey, chats);
        await new Promise((resolve) => setTimeout(resolve));
      });
    };
    await answer([row("a"), row("b")]);
    const before = renders();

    await answer([row("a"), row("b", { latest: WRITING })]);
    expect(renders()).toEqual(before);

    await answer([row("a"), row("b", { latest: WRITING, unread: true })]);
    expect(renders()).toEqual({ ...before, chrome: before.chrome + 1 });

    await answer([
      row("a", { title: "Renamed" }),
      row("b", { latest: WRITING, unread: true }),
    ]);
    expect(renders()).toEqual({
      chrome: before.chrome + 2,
      row: before.row + 1,
    });
  });
});
