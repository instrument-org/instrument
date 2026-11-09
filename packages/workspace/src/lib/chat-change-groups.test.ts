import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { chatChangeGroups, chatChangeGroupWords } from "./chat-change-groups";

const chat = (name: string) => ChatIdSchema.parse(name);

const TRAVEL = "prj_travel";

function line(changes: SessionMessageDataPart.ChatChange[]) {
  return chatChangeGroups(changes)
    .map((group, index) =>
      chatChangeGroupWords(group, {
        first: index === 0,
        ...(group.project === TRAVEL && { projectName: "Travel" }),
      }),
    )
    .join(" · ");
}

describe("chatChangeGroups", () => {
  it("groups a turn's changes by what was done, in the order first done", () => {
    expect(
      line([
        { after: "Lisbon", before: "Trip", chat: chat("a"), field: "title" },
        { after: true, before: false, chat: chat("b"), field: "archived" },
        { after: "Porto", before: "Trip 2", chat: chat("c"), field: "title" },
        { after: TRAVEL, before: null, chat: chat("a"), field: "project" },
        { after: TRAVEL, before: null, chat: chat("c"), field: "project" },
        { after: null, before: TRAVEL, chat: chat("d"), field: "project" },
        { after: false, before: true, chat: chat("e"), field: "starred" },
      ]),
    ).toMatchInlineSnapshot(
      `"Renamed 2 chats · Archived 1 · Filed 2 under Travel · Removed 1 from its project · Unstarred 1"`,
    );
  });

  it("says one chat as one", () => {
    expect(
      line([{ after: true, before: false, chat: chat("a"), field: "starred" }]),
    ).toMatchInlineSnapshot(`"Starred 1 chat"`);
  });

  it("names a project that is gone as a project", () => {
    expect(
      line([
        { after: "prj_gone", before: null, chat: chat("a"), field: "project" },
      ]),
    ).toMatchInlineSnapshot(`"Filed 1 chat under a project"`);
  });
});
