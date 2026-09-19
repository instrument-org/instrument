import { describe, expect, it } from "vitest";

import { threadContextModelNote } from "./thread-context-model-text";

const sentAt = Date.parse("2026-09-19T12:00:00.000Z");

describe("threadContextModelNote", () => {
  it("leads each thread with the id a link to it carries", () => {
    expect(
      threadContextModelNote({
        sentAt,
        threads: [
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
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Other threads in the user's chat, newest first, each by its id, when it last moved, its title, its topics, and its latest line:
      - ses_01M2XZWYFZT1K56M7734XB3V9Z · 2 minutes ago · "Groceries for the week" [Home] · Starting the list.
      - 1 day ago · "Trip to Lisbon"
      A message here that only makes sense against one of them is about that thread: \`chat read <id or title words>\` reads it before you answer.
      </instrument-system-note>"
    `);
  });
});
