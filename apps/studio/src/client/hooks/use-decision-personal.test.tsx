import { featuresAtom } from "@/client/atoms/features";
import { type Chat, type Topic } from "@/client/components/window/chats";
import { useEmojiSuggestions } from "@/client/components/window/emoji-suggestions";
import { useChatSearchFallback } from "@/client/components/window/use-chat-search-fallback";
import { useDraftTopicSuggestion } from "@/client/components/window/use-draft-topic-suggestion";
import { useTopicBackfill } from "@/client/components/window/use-topic-backfill";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ask, checkAvailable } = vi.hoisted(() => ({
  ask: vi.fn<(input: { state: unknown }) => Promise<unknown>>(),
  checkAvailable: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    features: {
      // The flags come from the store each test seeds; the stream says nothing.
      live: { getAll: { call: () => new Promise(() => {}) } },
    },
    workspace: {
      decision: {
        ask: { call: ask },
        available: {
          queryKey: () => ["decision-available"],
          queryOptions: (options: object) => ({
            ...options,
            queryFn: checkAvailable,
            queryKey: ["decision-available"],
          }),
        },
      },
    },
  },
}));

// Fixtures carry only what the hooks read; the full RPC shapes are far wider.
const CHAT = { id: "c1", title: "1099 forms" } as unknown as Chat;
const TOPIC = { about: null, id: "t1", name: "Garden" } as unknown as Topic;
const EMOJI = [{ group: 0, label: "seedling", unicode: "🌱" }];

/** Every ask that sends the person's own content, each as its caller makes it. */
const PERSONAL: [string, () => unknown][] = [
  [
    "chat search by meaning",
    () =>
      useChatSearchFallback({
        active: true,
        candidates: [CHAT],
        search: "accountant stuff",
      }),
  ],
  [
    "draft topic filing",
    () => {
      useDraftTopicSuggestion({
        draft: { createdAt: 0, id: "d1", updatedAt: 0, words: "" },
        onChange: () => {},
        topics: [TOPIC],
        words: "help me plan the raised beds",
      });
    },
  ],
  [
    "new topic backfill",
    () =>
      useTopicBackfill({
        candidates: [{ asked: "When do I plant?", id: CHAT.id, title: "Beds" }],
        name: "Garden",
        open: true,
      }),
  ],
  [
    "emoji for a topic's name",
    () => useEmojiSuggestions("Garden", EMOJI, { personal: true }),
  ],
];

function render(hook: () => unknown, flag: boolean) {
  const store = createStore();
  store.set(featuresAtom, {
    context_ring: false,
    suggestions_from_your_chats: flag,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The model can answer: a gate that is off must say otherwise.
  queryClient.setQueryData(["decision-available"], true);
  renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>{children}</JotaiProvider>
      </QueryClientProvider>
    ),
  });
}

/** Past every hook's pause in typing. */
async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(2000));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  ask.mockReset();
  ask.mockResolvedValue({ answers: {}, model: "clef-flash" });
  checkAvailable.mockReset();
  checkAvailable.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("asks that send the person's own content", () => {
  it.each(PERSONAL)("%s asks nothing with the flag off", async (_, hook) => {
    render(hook, false);
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(checkAvailable).not.toHaveBeenCalled();
  });

  it.each(PERSONAL)("%s asks with the flag on", async (_, hook) => {
    render(hook, true);
    await settle();
    await waitFor(() => {
      expect(ask).toHaveBeenCalled();
    });
  });
});

it("the emoji picker's own search is asked with the flag off", async () => {
  render(
    () => useEmojiSuggestions("jurassic", EMOJI, { personal: false }),
    false,
  );
  await settle();
  await waitFor(() => {
    expect(ask).toHaveBeenCalled();
  });
});

it("a topic's name settling behind a search typed over it is never sent", async () => {
  const store = createStore();
  const queryClient = new QueryClient();
  queryClient.setQueryData(["decision-available"], true);
  const { rerender } = renderHook(
    ({ personal, text }: { personal: boolean; text: string }) =>
      useEmojiSuggestions(text, EMOJI, { personal }),
    {
      initialProps: { personal: true, text: "Garden" },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <JotaiProvider store={store}>{children}</JotaiProvider>
        </QueryClientProvider>
      ),
    },
  );
  await settle();
  rerender({ personal: false, text: "jurassic" });
  await settle();
  expect(ask.mock.calls.map(([input]) => input.state)).toEqual(["jurassic"]);
});
