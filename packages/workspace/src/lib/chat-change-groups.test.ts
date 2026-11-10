import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { chatChangesByChat, chatChangesHeading } from "./chat-change-groups";

type ChatChange = SessionMessageDataPart.ChatChange;

const chat = (name: string) => ChatIdSchema.parse(name);

const TRAVEL = "prj_travel";

const archived = (name: string): ChatChange => ({
  after: true,
  before: false,
  chat: chat(name),
  field: "archived",
});

describe("chatChangesHeading", () => {
  const cases: [string, ChatChange[]][] = [
    ["two archived", [archived("a"), archived("b")]],
    ["one archived", [archived("a")]],
    [
      "one unarchived",
      [{ after: false, before: true, chat: chat("a"), field: "archived" }],
    ],
    [
      "one starred",
      [{ after: true, before: false, chat: chat("a"), field: "starred" }],
    ],
    [
      "one renamed",
      [{ after: "Lisbon", before: "Trip", chat: chat("a"), field: "title" }],
    ],
    [
      "two filed",
      [
        { after: TRAVEL, before: null, chat: chat("a"), field: "project" },
        { after: TRAVEL, before: null, chat: chat("b"), field: "project" },
      ],
    ],
    [
      "one taken out",
      [{ after: null, before: TRAVEL, chat: chat("a"), field: "project" }],
    ],
    [
      "one renamed and filed",
      [
        { after: "Lisbon", before: "Trip", chat: chat("a"), field: "title" },
        { after: TRAVEL, before: null, chat: chat("a"), field: "project" },
      ],
    ],
    [
      "filed and archived",
      [
        { after: TRAVEL, before: null, chat: chat("a"), field: "project" },
        { after: TRAVEL, before: null, chat: chat("b"), field: "project" },
        archived("c"),
      ],
    ],
  ];

  it("names one kind of change, and says Organized for several", () => {
    expect(
      Object.fromEntries(
        cases.map(([name, changes]) => [name, chatChangesHeading(changes)]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "filed and archived": "Organized 3 chats",
        "one archived": "Archived a chat",
        "one renamed": "Renamed a chat",
        "one renamed and filed": "Organized a chat",
        "one starred": "Starred a chat",
        "one taken out": "Removed a chat from its project",
        "one unarchived": "Unarchived a chat",
        "two archived": "Archived 2 chats",
        "two filed": "Moved 2 chats",
      }
    `);
  });
});

describe("chatChangesByChat", () => {
  it("gathers each chat's changes, chats in the order first changed", () => {
    expect(
      chatChangesByChat([
        { after: TRAVEL, before: null, chat: chat("a"), field: "project" },
        archived("b"),
        { after: "Lisbon", before: "Trip", chat: chat("a"), field: "title" },
      ]).map(({ changes, chat: id }) => [id, changes.map((c) => c.field)]),
    ).toEqual([
      ["a", ["project", "title"]],
      ["b", ["archived"]],
    ]);
  });
});
