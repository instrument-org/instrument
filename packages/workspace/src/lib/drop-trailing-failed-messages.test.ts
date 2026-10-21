import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import {
  dropRetriedFailedMessages,
  dropTrailingFailedMessages,
} from "./drop-trailing-failed-messages";

const mockDate = new Date("2026-08-12T00:00:00.000Z");
const sessionId = StoreId.newSessionId();

function createAssistantMessage({
  error,
  finished = true,
  text,
}: {
  error?: SessionMessage.Assistant["metadata"]["error"];
  /** False for a reply still being written. */
  finished?: boolean;
  text: string;
}): SessionMessage.AssistantWithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: {
      createdAt: mockDate,
      error,
      finishedAt: finished ? mockDate : undefined,
      finishReason: error ? "unknown" : "stop",
      modelId: "mock-model-id",
      providerId: "mock-provider-id",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: mockDate,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        text,
        type: "text",
      },
    ],
    role: "assistant",
  };
}

function createUserMessage(text: string): SessionMessage.UserWithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: { createdAt: mockDate, sessionId },
    parts: [
      {
        metadata: {
          createdAt: mockDate,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        text,
        type: "text",
      },
    ],
    role: "user",
  };
}

const apiCallError = {
  kind: "api-call",
  message: "Overloaded",
  name: "AI_APICallError",
  url: "https://example.com",
} as const satisfies SessionMessage.Assistant["metadata"]["error"];

function describeMessages(messages: SessionMessage.WithParts[]) {
  return messages.map(
    (message) =>
      `${message.role}${
        message.role === "assistant" && message.metadata.error
          ? ` (${message.metadata.error.kind})`
          : ""
      }`,
  );
}

describe("dropTrailingFailedMessages", () => {
  it("drops every failed attempt at the end of the session", () => {
    const messages = [
      createUserMessage("Build the page"),
      createAssistantMessage({ text: "Working on it" }),
      createAssistantMessage({ error: apiCallError, text: "" }),
      createAssistantMessage({ error: apiCallError, text: "Half a sen" }),
    ];

    expect(describeMessages(dropTrailingFailedMessages(messages)))
      .toMatchInlineSnapshot(`
        [
          "user",
          "assistant",
        ]
      `);
  });

  it("keeps a failure the conversation carried on past", () => {
    const messages = [
      createUserMessage("Build the page"),
      createAssistantMessage({ error: apiCallError, text: "Half a sen" }),
      createUserMessage("Try the other model"),
      createAssistantMessage({ text: "Done" }),
    ];

    expect(describeMessages(dropTrailingFailedMessages(messages)))
      .toMatchInlineSnapshot(`
        [
          "user",
          "assistant (api-call)",
          "user",
          "assistant",
        ]
      `);
  });

  it("drops a turn the user stopped", () => {
    const messages = [
      createUserMessage("Build the page"),
      createAssistantMessage({
        error: { kind: "aborted", message: "Aborted" },
        text: "Working on i",
      }),
    ];

    expect(describeMessages(dropTrailingFailedMessages(messages)))
      .toMatchInlineSnapshot(`
        [
          "user",
        ]
      `);
  });

  it("returns the same list when the session ends in a message that succeeded", () => {
    const messages = [
      createUserMessage("Build the page"),
      createAssistantMessage({ text: "Done" }),
    ];

    expect(dropTrailingFailedMessages(messages)).toBe(messages);
  });
});

describe("dropRetriedFailedMessages", () => {
  it("drops the attempts at a step once its retry finished", () => {
    const messages = [
      createUserMessage("Build the page"),
      createAssistantMessage({ text: "Working on it" }),
      createAssistantMessage({ error: apiCallError, text: "Half a sen" }),
      createAssistantMessage({ error: apiCallError, text: "" }),
      createAssistantMessage({ text: "Done" }),
      createUserMessage("Thanks"),
    ];

    expect(describeMessages(dropRetriedFailedMessages(messages)))
      .toMatchInlineSnapshot(`
        [
          "user",
          "assistant",
          "assistant",
          "user",
        ]
      `);
  });

  it("keeps a failure the user answered", () => {
    const messages = [
      createUserMessage("Build the page"),
      createAssistantMessage({ error: apiCallError, text: "Half a sen" }),
      createUserMessage("Try the other model"),
      createAssistantMessage({ text: "Done" }),
    ];

    expect(dropRetriedFailedMessages(messages)).toBe(messages);
  });

  it("keeps a failure whose retry is still being written", () => {
    const messages = [
      createUserMessage("Build the page"),
      createAssistantMessage({ error: apiCallError, text: "Half a sen" }),
      createAssistantMessage({ finished: false, text: "Working" }),
    ];

    expect(dropRetriedFailedMessages(messages)).toBe(messages);
  });

  it("keeps a reply the user stopped", () => {
    const messages = [
      createUserMessage("Build the page"),
      createAssistantMessage({
        error: { kind: "aborted", message: "Aborted" },
        text: "Working on i",
      }),
      createAssistantMessage({ text: "Done" }),
    ];

    expect(dropRetriedFailedMessages(messages)).toBe(messages);
  });
});
