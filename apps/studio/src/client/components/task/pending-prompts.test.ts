import { type SessionMessage, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { pendingPrompt, unsettledPrompts } from "./pending-prompts";

const sessionId = StoreId.newSessionId();

function send(messages: SessionMessage.WithParts[], prompt: string) {
  const entry = pendingPrompt({ messages, prompt, sessionId });
  if (!entry) {
    throw new Error("expected a pending prompt");
  }
  return entry;
}

function stored(
  text: string,
  role: "assistant" | "user" = "user",
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  const parts: SessionMessage.UserWithParts["parts"] = [
    {
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId: id,
        sessionId,
      },
      text,
      type: "text",
    },
  ];
  return role === "user"
    ? { id, metadata: { createdAt, sessionId }, parts, role }
    : {
        id,
        metadata: {
          createdAt,
          finishReason: "stop",
          modelId: "m",
          providerId: "p",
          sessionId,
        },
        parts,
        role,
      };
}

describe("pendingPrompt", () => {
  it("draws the words as they will be stored", () => {
    expect(send([], "  hello there \n").message.parts[0]).toMatchObject({
      text: "hello there",
      type: "text",
    });
  });

  it("draws nothing for a send with no words", () => {
    expect(pendingPrompt({ messages: [], prompt: "  ", sessionId })).toBe(
      undefined,
    );
  });
});

describe("unsettledPrompts", () => {
  it("keeps a prompt until its stored copy arrives", () => {
    const before = [stored("earlier")];
    const entry = send(before, "hi");
    expect(unsettledPrompts([entry], before)).toEqual([entry]);
    expect(unsettledPrompts([entry], [...before, stored("hi")])).toEqual([]);
  });

  it("is not settled by the same words said before it was sent, or by the reply", () => {
    const before = [stored("ok")];
    const entry = send(before, "ok");
    expect(
      unsettledPrompts([entry], [...before, stored("ok", "assistant")]),
    ).toEqual([entry]);
  });

  it("waits for one stored copy per send of the same words", () => {
    const first = send([], "again");
    const second = send([], "again");
    const once = [stored("again")];
    expect(unsettledPrompts([first, second], once)).toEqual([second]);
    expect(
      unsettledPrompts([first, second], [...once, stored("again")]),
    ).toEqual([]);
  });
});
