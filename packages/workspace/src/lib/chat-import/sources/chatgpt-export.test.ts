import { describe, expect, it } from "vitest";

import {
  chatGptRemodel,
  chatGptUntitled,
} from "../../../test/helpers/chat-exports";
import { readConversation } from "./chatgpt-export";

describe("readConversation", () => {
  it("reads the branch the person last saw, one message per reply", () => {
    expect(readConversation(chatGptRemodel())).toMatchInlineSnapshot(`
      {
        "createdAt": 2026-03-01T12:00:00.000Z,
        "kind": "chatgpt-export",
        "messages": [
          {
            "createdAt": 2026-03-01T12:00:10.123Z,
            "role": "user",
            "text": "Help me plan a kitchen remodel.",
          },
          {
            "createdAt": 2026-03-01T12:00:25.123Z,
            "model": "gpt-5-thinking",
            "role": "assistant",
            "text": "Start with a budget. Then pick a layout.",
          },
          {
            "createdAt": 2026-03-01T12:01:00.123Z,
            "omitted": {
              "attachments": 1,
            },
            "role": "user",
            "text": "What about tile floors like this?",
          },
          {
            "createdAt": 2026-03-01T12:01:10.123Z,
            "model": "gpt-5",
            "omitted": {
              "attachments": 1,
              "toolCalls": {
                "dalle.text2im": 1,
              },
            },
            "role": "assistant",
            "text": "Here is a sketch of a herringbone tile floor.",
          },
        ],
        "preview": "Help me plan a kitchen remodel.",
        "sourceId": "gpt-remodel",
        "title": "Kitchen remodel",
        "updatedAt": 2026-03-01T12:01:10.123Z,
      }
    `);
  });

  it("titles an untitled conversation by its opening ask and dates undated messages by the conversation", () => {
    expect(readConversation(chatGptUntitled())).toMatchInlineSnapshot(`
      {
        "createdAt": 2026-03-01T12:16:40.000Z,
        "kind": "chatgpt-export",
        "messages": [
          {
            "createdAt": 2026-03-01T12:16:40.000Z,
            "role": "user",
            "text": "What's a good   name for a cat?",
          },
          {
            "createdAt": 2026-03-01T12:16:40.000Z,
            "role": "assistant",
            "text": "Miso.",
          },
        ],
        "preview": "What's a good name for a cat?",
        "sourceId": "gpt-untitled",
        "title": "What's a good name for a cat?",
        "updatedAt": 2026-03-01T12:16:40.000Z,
      }
    `);
  });

  it("follows the newest leaf when there is no current node", () => {
    const conversation = chatGptRemodel();
    delete conversation.current_node;
    const read = readConversation(conversation);
    expect(read?.messages.map((message) => message.text))
      .toMatchInlineSnapshot(`
      [
        "Help me plan a kitchen remodel.",
        "Start with a budget. Then pick a layout.",
        "What about tile floors like this?",
        "Here is a sketch of a herringbone tile floor.",
      ]
    `);
  });

  it.each([
    ["not an object", "nope"],
    ["no id", { title: "x", create_time: 1, mapping: {} }],
    ["no date anywhere", { id: "x", mapping: {} }],
  ])("skips a conversation with %s", (_, raw) => {
    expect(readConversation(raw)).toBeUndefined();
  });

  it("reads a conversation whose mapping is the wrong shape as one with no messages", () => {
    expect(
      readConversation({ id: "x", create_time: 1_772_366_400, mapping: [] }),
    ).toMatchInlineSnapshot(`
      {
        "createdAt": 2026-03-01T12:00:00.000Z,
        "incidental": true,
        "kind": "chatgpt-export",
        "messages": [],
        "sourceId": "x",
        "title": "",
        "updatedAt": 2026-03-01T12:00:00.000Z,
      }
    `);
  });
});
