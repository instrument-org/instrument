import { describe, expect, it } from "vitest";

import { chatContextModelNote } from "./chat-context-model-text";

const sentAt = Date.parse("2026-09-19T12:00:00.000Z");

describe("chatContextModelNote", () => {
  it("leads each chat with the id a link to it carries", () => {
    expect(
      chatContextModelNote({
        chats: [
          {
            at: Date.parse("2026-09-19T11:58:00.000Z"),
            id: "ses_01M2XZWYFZT1K56M7734XB3V9Z",
            latest: "Starting the list.",
            title: "Groceries for the week",
            topics: ["Home"],
          },
          {
            at: Date.parse("2026-09-18T12:00:00.000Z"),
            title: "Trip to Lisbon",
            topics: [],
          },
        ],
        sentAt,
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user's other chats, newest first, each by its id, when it last moved, its title, its topics, and its latest line:
      - ses_01M2XZWYFZT1K56M7734XB3V9Z · 2 minutes ago · "Groceries for the week" [Home] · Starting the list.
      - 1 day ago · "Trip to Lisbon"
      A message here that only makes sense against one of them is about that chat: \`chat read <id or title words>\` reads it before you answer.
      </instrument-system-note>"
    `);
  });
});
