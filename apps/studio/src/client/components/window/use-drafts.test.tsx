import { type WindowTab } from "@/client/atoms/window";
import { makeNewChatDraftAtom } from "@/client/drafts/new-chat-box";
import { renderWithProviders } from "@/tests/render";
import { AIGatewayModelURI } from "@instrument-org/ai-gateway/schemas";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { waitFor } from "@testing-library/react";
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
