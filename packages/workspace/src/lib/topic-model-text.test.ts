import { describe, expect, it } from "vitest";

import { topicModelNote } from "./topic-model-text";

describe("topicModelNote", () => {
  it("names the topic, then gives its instructions and folders", () => {
    expect(
      topicModelNote({
        topic: {
          about: "getting away",
          emoji: "✈️",
          folders: ["/Users/sam/Trips", "/Users/sam/Receipts"],
          instructions: "Book aisle seats.\n\nKeep hotels under $200 a night.",
          name: "Travel",
        },
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      This chat is filed under the topic ✈️ "Travel" (getting away). Topics are tags the user puts on chats to find them by; read the chat through it.

      The user's instructions for every chat under "Travel":
      <topic_instructions>
      Book aisle seats.

      Keep hotels under $200 a night.
      </topic_instructions>

      Folders the work under "Travel" uses, attached to this chat: \`/Users/sam/Trips\`, \`/Users/sam/Receipts\`. Hand a task the ones its work needs.
      </instrument-system-note>"
    `);
  });

  it("says the chat has no topic once it is taken off", () => {
    expect(topicModelNote({ topic: null })).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      This chat has no topic now.
      </instrument-system-note>"
    `);
  });

  it("cuts long instructions on a paragraph break, naming the topic's own file", () => {
    const note = topicModelNote({
      topic: {
        instructions: `${"a".repeat(19_990)}\n\n${"ZZZ ".repeat(30)}`,
        name: "Long",
      },
    });
    expect(note).not.toContain("ZZZ");
    expect(note).toContain(
      "[Cut off here: the rest is in Topics/Long/TOPIC.md.]",
    );
  });
});
