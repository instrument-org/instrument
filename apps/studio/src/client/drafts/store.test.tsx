import { type ChatId } from "@instrument-org/workspace/client";
import { type Draft, type DraftOpBatch } from "@/shared/drafts";
import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDraftOpsAtom,
  draftsAtom,
  rebase,
  resetDrafts,
  shownDrafts,
  type Sync,
} from "./store";

const CHAT = "2026-10-19-what-s-my-latest-tweet" as ChatId;

const draft = (id: string, more: Partial<Draft> = {}): Draft => ({
  createdAt: 1,
  id,
  updatedAt: 1,
  words: "",
  ...more,
});

const batch = (seq: number, ops: DraftOpBatch["ops"]): DraftOpBatch => ({
  client: "me",
  ops,
  seq,
});

afterEach(() => {
  resetDrafts();
});

describe("a window's drafts", () => {
  it("show what the window sent before main says it has it", () => {
    const sync: Sync = {
      confirmed: { acks: {}, drafts: [draft("a", { words: "Plan" })] },
      pending: [batch(1, [{ id: "a", type: "remove" }])],
    };
    expect(shownDrafts(sync)).toEqual([]);
  });

  // The window took a sent draft away while main, a beat behind, was still
  // telling it about the draft as the folder had it. The change from main
  // arrives first and must not bring the draft back.
  it("keep a change still on its way over a snapshot sent before main had it", () => {
    const sent: Sync = {
      confirmed: { acks: { me: 0 }, drafts: [draft("a")] },
      pending: [batch(1, [{ id: "a", type: "sent" }])],
    };

    const crossed = rebase(
      sent,
      {
        acks: { me: 0 },
        drafts: [draft("a", { chatId: CHAT, words: "what's my latest tweet" })],
      },
      "me",
    );
    expect(shownDrafts(crossed)).toEqual([]);
    expect(crossed.pending).toHaveLength(1);

    const settled = rebase(crossed, { acks: { me: 1 }, drafts: [] }, "me");
    expect(settled.pending).toEqual([]);
    expect(shownDrafts(settled)).toEqual([]);
  });

  it("take in a change made elsewhere under one of their own", () => {
    const typing: Sync = {
      confirmed: { acks: { me: 0 }, drafts: [draft("a", { words: "Plan" })] },
      pending: [
        batch(1, [
          { at: 2, id: "a", set: { words: "Plan the trip" }, type: "update" },
        ]),
      ],
    };

    const fromPhone = rebase(
      typing,
      {
        acks: { me: 0 },
        drafts: [draft("a", { topicId: "travel", words: "Plan" })],
      },
      "me",
    );

    expect(shownDrafts(fromPhone)).toEqual([
      draft("a", { topicId: "travel", updatedAt: 2, words: "Plan the trip" }),
    ]);
  });

  it("show main's answer once it has applied what the window sent", async () => {
    resetDrafts([draft("a", { words: "Plan" })]);
    const store = createStore();
    store.sub(draftsAtom, () => undefined);

    await store.set(applyDraftOpsAtom, [
      { at: 2, id: "a", set: { words: "Plan the trip" }, type: "update" },
    ]);

    expect(store.get(draftsAtom).map((entry) => entry.words)).toEqual([
      "Plan the trip",
    ]);
  });
});
