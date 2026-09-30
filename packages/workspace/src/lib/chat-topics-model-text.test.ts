import { describe, expect, it } from "vitest";

import { chatTopicsModelNote } from "./chat-topics-model-text";

describe("chatTopicsModelNote", () => {
  it("names the topics, then gives each one's instructions and folders", () => {
    expect(
      chatTopicsModelNote({
        topics: [
          {
            emoji: "✈️",
            folders: ["/mnt/Trips", "/mnt/Receipts"],
            instructions: "Book aisle seats.\n\nKeep hotels under $200 a night.",
            name: "Travel",
          },
          { about: "the house", name: "Home" },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      This chat is filed under the topics ✈️ "Travel", "Home" (the house). Topics are tags the user puts on chats to find them by; read the chat through them.

      The user's instructions for every chat under "Travel":
      <topic_instructions>
      Book aisle seats.

      Keep hotels under $200 a night.
      </topic_instructions>

      Folders the work under "Travel" uses, attached to this chat: /mnt/Trips, /mnt/Receipts. Hand a task the ones its work needs.
      </instrument-system-note>"
    `);
  });

  it("cuts long instructions on a paragraph break, saying so", () => {
    const note = chatTopicsModelNote({
      topics: [
        {
          instructions: `${"a".repeat(19_990)}\n\n${"ZZZ ".repeat(30)}`,
          name: "Long",
        },
      ],
    });
    expect(note).not.toContain("ZZZ");
    expect(note).toContain(
      "[Cut off here: the rest of these instructions is too long to include.]",
    );
  });
});
