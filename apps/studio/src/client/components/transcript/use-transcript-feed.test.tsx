import {
  type ChatId,
  StoreId,
  type TranscriptFeed,
  transcriptMessage,
  type TranscriptMessage,
} from "@instrument-org/workspace/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { expect, it, vi } from "vitest";

const { older } = vi.hoisted(() => ({
  older: vi.fn<(input: { before: string }) => Promise<unknown>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      message: { live: { feed: { call: vi.fn() } }, older: { call: older } },
    },
  },
}));

const { transcriptFeedOptions, useTranscriptFeed } =
  await import("./use-transcript-feed");

const sessionId = StoreId.newSessionId();

function typed(words: string): TranscriptMessage {
  const id = StoreId.newMessageId();
  const metadata = { createdAt: new Date(0), id, messageId: id, sessionId };
  const light = transcriptMessage(
    // A stored message with only the fields a light message is made from.
    {
      id,
      metadata: { createdAt: new Date(0), sessionId },
      parts: [{ metadata, state: "done", text: words, type: "text" }],
      role: "user",
    } as unknown as Parameters<typeof transcriptMessage>[0],
  );
  if (!light) {
    throw new Error("Not a transcript message");
  }
  return light;
}

/** A request for a page, answered when the test says. */
function page() {
  let answer: (feed: TranscriptFeed) => void = () => {};
  const request = new Promise<TranscriptFeed>((resolve) => {
    answer = resolve;
  });
  return { answer, request };
}

it("asks once for a page two loads want, and stays loading until both end", async () => {
  const messages = Array.from({ length: 6 }, (_, at) =>
    typed(`Message ${at.toString()}`),
  );
  const [oldest, third, newest] = [messages[0], messages[2], messages[4]];
  const input = {
    // The id of a chat no record is read for.
    id: "chat" as ChatId,
    sessionId,
  };
  const client = new QueryClient();
  client.setQueryData(transcriptFeedOptions(input).queryKey, {
    hasOlder: true,
    messages: messages.slice(4),
    olderTurns: 2,
  });
  const [above, top] = [page(), page()];
  older
    .mockReturnValueOnce(above.request)
    .mockReturnValueOnce(top.request)
    .mockRejectedValue(new Error("Asked for a page it holds."));
  const { result } = renderHook(
    () => useTranscriptFeed(input, { enabled: false }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  // The sentinel's load, as it was before the find's load raised the flag.
  const { loadOlder } = result.current;
  if (!oldest || !third || !newest) {
    throw new Error("The session is shorter than the test reads.");
  }

  let found: Promise<boolean> | undefined;
  act(() => {
    found = result.current.loadOlderThrough(oldest.id);
    loadOlder();
  });
  expect(older.mock.calls.map(([asked]) => asked.before)).toEqual([newest.id]);
  expect(result.current.isLoadingOlder).toBe(true);

  // The sentinel's load ends with the first page, and the find's goes on.
  await act(async () => {
    above.answer({
      hasOlder: true,
      messages: messages.slice(2, 4),
      olderTurns: 1,
    });
    await above.request;
  });
  await vi.waitFor(() => {
    expect(older).toHaveBeenCalledTimes(2);
  });
  expect(result.current.isLoadingOlder).toBe(true);
  act(() => {
    loadOlder();
  });
  expect(older.mock.calls.map(([asked]) => asked.before)).toEqual([
    newest.id,
    third.id,
  ]);

  await act(async () => {
    top.answer({
      hasOlder: false,
      messages: messages.slice(0, 2),
      olderTurns: 0,
    });
    await found;
  });
  await expect(found).resolves.toBe(true);
  await vi.waitFor(() => {
    expect(result.current.isLoadingOlder).toBe(false);
  });
  expect(result.current.data?.messages.map((message) => message.id)).toEqual(
    messages.map((message) => message.id),
  );
});
