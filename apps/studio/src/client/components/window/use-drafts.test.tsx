import { type WindowTab } from "@/client/atoms/window";
import { makeNewChatDraftAtom } from "@/client/drafts/new-chat-box";
import { renderWithProviders } from "@/tests/render";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway/schemas";
import { type ChatId, ChatIdSchema } from "@instrument-org/workspace/client";
import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDrafts } from "./use-drafts";
import { chatHref, newChatHref } from "./window-href";

const calls = vi.hoisted(() => ({
  chat: "2026-11-13-sent-at-once",
  create: vi.fn(() => Promise.resolve({})),
  turn: vi.fn<(href: string) => void>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        ensure: { call: () => Promise.resolve({ id: calls.chat }) },
        session: { queryKey: () => ["session"] },
      },
      message: {
        create: { mutationOptions: () => ({ mutationFn: calls.create }) },
      },
    },
  },
}));

vi.mock("@/client/lib/group-tab-router-registry", () => ({
  getGroupTabRouter: () => ({ history: { replace: calls.turn } }),
}));

const MODEL = AIGatewayModelURI.Schema.parse(
  "instrument/auto?provider=instrument&providerConfigId=instrument",
);

/** A new chat's tab before its first words settle: its address names no draft. */
const TAB: WindowTab = {
  group: "group:1",
  href: newChatHref(),
  id: "new",
  kind: "screen",
};

function Drafts({
  onDrafts,
}: {
  onDrafts: (drafts: ReturnType<typeof useDrafts>) => void;
}) {
  onDrafts(
    useDrafts({
      browser: null,
      draftContext: () => Promise.resolve(undefined),
      folders: {},
      isChat: false,
      isOpen: true,
      openDraftInChat: () => undefined,
      projects: [],
      saveDefaultModelURI: () => undefined,
      windowTabs: { allTabs: [TAB], replace: () => undefined },
    }),
  );
  return null;
}

describe("starting a chat from a new chat's tab", () => {
  // Enter pressed right after the last key: the draft is made in the same
  // press that sends it, so the tab's address is still the empty new chat's.
  it("turns the tab into the chat when the words are sent at once after typing", async () => {
    let drafts: ReturnType<typeof useDrafts> | undefined;
    const { store } = renderWithProviders(
      <Drafts
        onDrafts={(current) => {
          drafts = current;
        }}
      />,
    );
    const id = store.set(makeNewChatDraftAtom, {
      tabId: TAB.id,
      words: "Plan the trip",
    });
    drafts?.startChat(id, { modelURI: MODEL, prompt: "Plan the trip" }, TAB.id);

    await waitFor(() => {
      expect(calls.create).toHaveBeenCalled();
    });
    expect(calls.turn).toHaveBeenCalledWith(
      chatHref(ChatIdSchema.parse(calls.chat)),
    );
  });
});

describe("the words a chat was started with", () => {
  /** Two chats started one right after the other, both sends answered. */
  async function startTwo() {
    let drafts: ReturnType<typeof useDrafts> | undefined;
    const { store } = renderWithProviders(
      <Drafts
        onDrafts={(current) => {
          drafts = current;
        }}
      />,
    );
    const chats: ChatId[] = [];
    for (const name of ["first", "second"]) {
      calls.chat = `2026-11-13-${name}`;
      chats.push(ChatIdSchema.parse(calls.chat));
      const id = store.set(makeNewChatDraftAtom, {
        tabId: TAB.id,
        words: name,
      });
      calls.create.mockClear();
      drafts?.startChat(id, { modelURI: MODEL, prompt: name }, TAB.id);
      await waitFor(() => {
        expect(calls.create).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(drafts?.arrivedId).toBe(calls.chat);
      });
    }
    const words = () =>
      chats.map((chat) => drafts?.sent.get(chat)?.words ?? null);
    const [first, second] = chats;
    if (!first || !second) {
      throw new Error("Two chats were started.");
    }
    return { drafts: () => drafts, first, second, words };
  }

  it("stay until that chat's own transcript has them", async () => {
    const { drafts, first, second, words } = await startTwo();
    expect(words()).toEqual(["first", "second"]);
    act(() => {
      drafts()?.sentStored(first);
    });
    expect(words()).toEqual([null, "second"]);
    act(() => {
      drafts()?.sentStored(second);
    });
    expect(words()).toEqual([null, null]);
  });
});
