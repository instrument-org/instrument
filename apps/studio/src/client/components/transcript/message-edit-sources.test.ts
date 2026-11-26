import {
  StoreId,
  transcriptMessage,
  type TranscriptMessage,
  turnsOf,
} from "@instrument-org/workspace/client";
import { expect, it } from "vitest";

import { keptEditSources } from "./message-edit-sources";

const sessionId = StoreId.newSessionId();
let clock = 0;

function said(role: "assistant" | "user", words: string): TranscriptMessage {
  const id = StoreId.newMessageId();
  const createdAt = new Date((clock += 1000));
  const light = transcriptMessage(
    // A stored message with only the fields a light message is made from.
    {
      id,
      metadata: {
        createdAt,
        sessionId,
        ...(role === "assistant" && {
          finishedAt: createdAt,
          modelId: "m",
          providerId: "p",
        }),
      },
      parts: [
        {
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId: id,
            sessionId,
          },
          state: "done",
          text: words,
          type: "text",
        },
      ],
      role,
    } as unknown as Parameters<typeof transcriptMessage>[0],
  );
  if (!light) {
    throw new Error("Not a transcript message");
  }
  return light;
}

const MESSAGES = [
  said("user", "Tighten this:\n\nI am writing to you today."),
  said(
    "assistant",
    "Here it is.\n\n```message\nmessage: other\n\nI am writing to you.\n```",
  ),
  said("user", "Warmer?"),
  said("assistant", "Warmer:\n\n:::message\nI'm so glad to write to you.\n:::"),
  said("user", "Thanks!"),
];

it("gives each turn that wrote a message the text before it, newest first", () => {
  const turns = turnsOf(MESSAGES, { isRunning: false, sessionId });
  const sources = keptEditSources(new Map(), turns);
  expect(turns.map((turn) => sources.get(turn.id))).toMatchInlineSnapshot(`
    [
      [
        {
          "from": "person",
          "text": "Tighten this:

    I am writing to you today.",
        },
      ],
      [
        {
          "from": "person",
          "text": "Warmer?",
        },
        {
          "from": "draft",
          "text": "I am writing to you.",
        },
        {
          "from": "person",
          "text": "Tighten this:

    I am writing to you today.",
        },
      ],
      undefined,
    ]
  `);
});

it("keeps a turn's sources while they read the same", () => {
  const kept = new Map();
  const options = { isRunning: true, sessionId };
  const [, before] = turnsOf(MESSAGES.slice(0, 4), options);
  const streamed = said(
    "assistant",
    "Warmer:\n\n:::message\nI'm so glad to write to you, truly.\n:::",
  );
  const [, after] = turnsOf([...MESSAGES.slice(0, 3), streamed], options);
  const first = before && keptEditSources(kept, [before]).get(before.id);
  const next = after && keptEditSources(kept, [after]).get(after.id);
  expect(first).toBeDefined();
  expect(next).toBe(first);
});
