import { renderWithProviders } from "@/tests/render";
import { useQuery } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * The subscriptions `chats.live.rows` opened, newest last: each sends what a
 * test pushes, and ends when its request does.
 */
const streams = vi.hoisted(() => {
  const opened: { closed: boolean; push: (event: unknown) => void }[] = [];
  const open = (signal: AbortSignal) => {
    const queued: unknown[] = [];
    let wake: (() => void) | undefined;
    const stream = {
      closed: false,
      push: (event: unknown) => {
        queued.push(event);
        wake?.();
      },
    };
    const close = () => {
      stream.closed = true;
      wake?.();
    };
    signal.addEventListener("abort", close, { once: true });
    opened.push(stream);
    return (async function* () {
      try {
        while (!stream.closed) {
          const event = queued.shift();
          if (event === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          yield event;
        }
      } finally {
        close();
      }
    })();
  };
  return { open, opened };
});

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        live: {
          rows: {
            call: (_input: undefined, { signal }: { signal: AbortSignal }) =>
              Promise.resolve(streams.open(signal)),
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
    sessionId: `ses_${id}`,
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

describe("the chat list query", () => {
  /** Lets the query take in what was pushed. */
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it("folds what the list sends into one list, and reads it again from the start on a change it missed", async () => {
    const queryClient = new QueryClient();
    const { queryKey } = chatListOptions();
    void queryClient.fetchQuery(chatListOptions());
    await settle();
    const first = streams.opened.at(-1);
    first?.push({
      epoch: "one",
      kind: "snapshot",
      rev: 0,
      rows: [row("a"), row("b")],
    });
    await settle();

    first?.push({
      epoch: "one",
      from: 0,
      kind: "patch",
      removed: ["a"],
      rev: 1,
      upserts: [row("c"), row("b", { title: "Renamed" })],
    });
    await settle();
    const patched = queryClient.getQueryData<Chat[]>(queryKey);
    expect(patched?.map((chat) => chat.title)).toEqual(["Renamed", "c"]);

    // Skips rev 2.
    first?.push({
      epoch: "one",
      from: 2,
      kind: "patch",
      removed: [],
      rev: 3,
      upserts: [],
    });
    await settle();
    expect(first?.closed).toBe(true);
    const second = streams.opened.at(-1);
    expect(second).not.toBe(first);
    second?.push({
      epoch: "two",
      kind: "snapshot",
      rev: 0,
      rows: [row("a"), row("c")],
    });
    await settle();
    const after = queryClient.getQueryData<Chat[]>(queryKey);
    expect(after?.map((chat) => chat.id)).toEqual(["a", "c"]);
    // Sent again the same, so the same object.
    expect(after?.[1]).toBe(patched?.[1]);
    void queryClient.cancelQueries();
  });
});
