import { type ChatId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  applyDraftOps,
  type Draft,
  draftUpdateOf,
  holdsSomething,
  repliesOf,
} from "./drafts";

const CHAT = "2026-10-19-latest-tweet" as ChatId;
const OTHER = "2026-10-19-taxes" as ChatId;

const draft = (id: string, more: Partial<Draft> = {}): Draft => ({
  createdAt: 1,
  id,
  updatedAt: 1,
  words: "",
  ...more,
});

describe("applying ops", () => {
  it("makes a draft once, whatever a second create with its id says", () => {
    const made = applyDraftOps(
      [],
      [
        { draft: draft("a", { words: "first" }), type: "create" },
        { draft: draft("a", { words: "second" }), type: "create" },
      ],
    );
    expect(made.map((entry) => entry.words)).toEqual(["first"]);
  });

  it("sets and clears fields, stamping the draft only when the update says when", () => {
    const [stamped] = applyDraftOps(
      [draft("a", { topicId: "house" })],
      [
        {
          at: 5,
          id: "a",
          set: { words: "Plan the trip" },
          type: "update",
          unset: ["topicId"],
        },
      ],
    );
    expect(stamped).toEqual(
      draft("a", { updatedAt: 5, words: "Plan the trip" }),
    );

    const [left] = applyDraftOps(
      [draft("a")],
      [{ id: "a", set: { words: "Plan" }, type: "update" }],
    );
    expect(left?.updatedAt).toBe(1);
  });

  it("leaves a draft that is gone gone, whatever is sent to it after", () => {
    expect(
      applyDraftOps(
        [draft("a")],
        [
          { id: "a", type: "remove" },
          { at: 2, id: "a", set: { words: "late" }, type: "update" },
        ],
      ),
    ).toEqual([]);
  });

  it("keeps every other draft as the same object, so a list can tell what changed", () => {
    const other = draft("b");
    const [, kept] = applyDraftOps(
      [draft("a"), other],
      [{ at: 2, id: "a", set: { words: "x" }, type: "update" }],
    );
    expect(kept).toBe(other);
  });

  it("claims a new chat's draft for its chat without making it that chat's reply, and releases it as it was", () => {
    const before = [draft("a", { words: "what's my latest t" })];
    const claimed = applyDraftOps(before, [
      {
        at: 3,
        chatId: CHAT,
        id: "a",
        type: "claim",
        words: "what's my latest tweet",
      },
    ]);
    expect(claimed[0]).toMatchObject({
      sendingTo: CHAT,
      words: "what's my latest tweet",
    });
    expect(claimed[0]?.chatId).toBeUndefined();
    expect(repliesOf(claimed, CHAT)).toEqual([]);

    const released = applyDraftOps(claimed, [{ id: "a", type: "release" }]);
    expect(released[0]?.sendingTo).toBeUndefined();
    expect(released[0]?.chatId).toBeUndefined();
  });
});

describe("a chat's replies", () => {
  it("are its drafts that are not on their way into it", () => {
    const drafts = [
      draft("waiting", { chatId: CHAT }),
      draft("sending", { chatId: CHAT, sendingTo: CHAT }),
      draft("elsewhere", { chatId: OTHER }),
      draft("new chat"),
    ];
    expect(repliesOf(drafts, CHAT).map((entry) => entry.id)).toEqual([
      "waiting",
    ]);
  });

  it.each([
    ["words", { words: "hi" }, true],
    ["only whitespace", { words: " \n" }, false],
    [
      "something attached",
      { attached: [{ kind: "folder" as const, path: "/a" }] },
      true,
    ],
  ])("hold something with %s: %s", (_case, more, holds) => {
    expect(holdsSomething(draft("a", more))).toBe(holds);
  });
});

describe("the update between two drafts", () => {
  it("names only the fields that changed, and the ones cleared", () => {
    const from = draft("a", {
      topicId: "house",
      topicSource: "chosen",
      words: "a",
    });
    const to = draft("a", { topicId: "money", words: "a" });
    expect(draftUpdateOf(from, to, 9)).toEqual({
      at: 9,
      id: "a",
      set: { topicId: "money" },
      type: "update",
      unset: ["topicSource"],
    });
  });

  it("is nothing where the drafts agree, the stamp aside", () => {
    expect(
      draftUpdateOf(draft("a"), draft("a", { updatedAt: 99 }), 5),
    ).toBeUndefined();
  });

  it("leaves the stamp out when asked to", () => {
    expect(
      draftUpdateOf(draft("a"), draft("a", { words: "b" }), null),
    ).not.toHaveProperty("at");
  });

  it("never carries the draft's identity or its send", () => {
    const op = draftUpdateOf(
      draft("a"),
      { ...draft("b", { createdAt: 7, sendingTo: CHAT }), words: "x" },
      1,
    );
    expect(op?.set).toEqual({ words: "x" });
  });
});
