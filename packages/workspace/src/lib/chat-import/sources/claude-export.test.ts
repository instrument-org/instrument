import { describe, expect, it } from "vitest";

import { claudeConversation } from "../../../test/helpers/chat-exports";
import { readConversation } from "./claude-export";

describe("readConversation", () => {
  it("reads content blocks, counting tool calls and attachments", () => {
    expect(readConversation(claudeConversation())).toMatchInlineSnapshot(`
      {
        "createdAt": 2026-04-02T09:00:00.000Z,
        "kind": "claude-export",
        "messages": [
          {
            "createdAt": 2026-04-02T09:00:00.000Z,
            "omitted": {
              "attachments": 2,
            },
            "role": "user",
            "text": "Which vegetables grow well in shade?",
          },
          {
            "createdAt": 2026-04-02T09:00:10.000Z,
            "omitted": {
              "toolCalls": {
                "web_search": 2,
              },
            },
            "role": "assistant",
            "text": "Leafy greens do well: lettuce, kale.

      Herbs like mint too.",
          },
          {
            "createdAt": 2026-04-02T09:05:00.000Z,
            "role": "user",
            "text": "Thanks!",
          },
        ],
        "preview": "Which vegetables grow well in shade?",
        "sourceId": "claude-garden",
        "title": "Garden planning",
        "updatedAt": 2026-04-02T09:05:00.000Z,
      }
    `);
  });

  it("follows parent links to the current leaf, leaving a retried reply out", () => {
    const at = (second: number) =>
      `2026-04-02T10:00:${String(second).padStart(2, "0")}.000Z`;
    const read = readConversation(
      claudeConversation({
        current_leaf_message_uuid: "a-retry",
        chat_messages: [
          {
            uuid: "q",
            sender: "human",
            text: "Hi",
            created_at: at(0),
            parent_message_uuid: "00000000-0000-4000-8000-000000000000",
          },
          {
            uuid: "a-first",
            sender: "assistant",
            text: "First try",
            created_at: at(1),
            parent_message_uuid: "q",
          },
          {
            uuid: "a-retry",
            sender: "assistant",
            text: "Second try",
            created_at: at(2),
            parent_message_uuid: "q",
          },
        ],
      }),
    );
    expect(read?.messages.map((message) => message.text))
      .toMatchInlineSnapshot(`
      [
        "Hi",
        "Second try",
      ]
    `);
  });

  it("reads a tool loop written as several assistant messages as one reply", () => {
    const at = (second: number) => `2026-04-02T10:00:0${second}.000Z`;
    const read = readConversation(
      claudeConversation({
        chat_messages: [
          {
            uuid: "t1",
            sender: "human",
            parent_message_uuid: null,
            created_at: at(1),
            content: [{ type: "text", text: "List my files" }],
          },
          {
            uuid: "t2",
            sender: "assistant",
            parent_message_uuid: "t1",
            created_at: at(2),
            content: [
              { type: "tool_use", id: "a", name: "bash", input: {} },
              { type: "tool_result", tool_use_id: "a", content: [] },
            ],
          },
          {
            uuid: "t3",
            sender: "assistant",
            parent_message_uuid: "t2",
            created_at: at(3),
            content: [
              { type: "tool_use", id: "b", name: "bash", input: {} },
              { type: "token_budget" },
            ],
          },
          {
            uuid: "t4",
            sender: "assistant",
            parent_message_uuid: "t3",
            created_at: at(4),
            content: [{ type: "text", text: "You have two files." }],
          },
        ],
      }),
    );
    expect(read?.messages).toMatchInlineSnapshot(`
      [
        {
          "createdAt": 2026-04-02T10:00:01.000Z,
          "role": "user",
          "text": "List my files",
        },
        {
          "createdAt": 2026-04-02T10:00:02.000Z,
          "omitted": {
            "toolCalls": {
              "bash": 2,
            },
          },
          "role": "assistant",
          "text": "You have two files.",
        },
      ]
    `);
  });

  it("files a conversation under its project's name", () => {
    const read = readConversation(
      claudeConversation({ project_uuid: "p1" }),
      new Map([["p1", "Backyard"]]),
    );
    expect(read?.project).toMatchInlineSnapshot(`"Backyard"`);
  });

  it("marks a conversation nobody replied to as incidental", () => {
    const read = readConversation(
      claudeConversation({
        name: "",
        chat_messages: [
          {
            uuid: "q",
            sender: "human",
            text: "Draft an email to my landlord about the leak",
            created_at: "2026-04-02T10:00:00Z",
          },
        ],
      }),
    );
    expect(read).toMatchInlineSnapshot(`
      {
        "createdAt": 2026-04-02T09:00:00.000Z,
        "incidental": true,
        "kind": "claude-export",
        "messages": [
          {
            "createdAt": 2026-04-02T10:00:00.000Z,
            "role": "user",
            "text": "Draft an email to my landlord about the leak",
          },
        ],
        "preview": "Draft an email to my landlord about the leak",
        "sourceId": "claude-garden",
        "title": "Draft an email to my landlord about the leak",
        "updatedAt": 2026-04-02T10:00:00.000Z,
      }
    `);
  });

  it.each([
    ["not an object", 4],
    ["no uuid", { name: "x", created_at: "2026-04-02T10:00:00Z" }],
    ["no date anywhere", { uuid: "x", created_at: "not a date" }],
  ])("skips a conversation with %s", (_, raw) => {
    expect(readConversation(raw)).toBeUndefined();
  });
});
