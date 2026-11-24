import { type SessionMessage, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  pendingPrompt,
  unsettledPrompts,
  withSentSwitch,
} from "./pending-prompts";

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

describe("withSentSwitch", () => {
  const change = { from: { modelId: "a" }, to: { modelId: "b" } };
  const entry = pendingPrompt({
    change,
    messages: [],
    prompt: "go",
    sessionId,
  });
  const switches = (messages: readonly { parts: { type: string }[] }[]) =>
    messages.map(
      ({ parts }) =>
        parts.filter((part) => part.type === "data-modelChange").length,
    );

  it("keeps the line on the stored copy until the turn records its own", () => {
    const copy = stored("go");
    expect(switches(withSentSwitch([copy], entry))).toEqual([1]);
    const recorded = {
      ...copy,
      parts: [...copy.parts, ...(entry?.message.parts.slice(1) ?? [])],
    } as typeof copy;
    expect(switches(withSentSwitch([recorded], entry))).toEqual([1]);
  });

  it.each([
    ["a reply follows", [stored("go"), stored("done", "assistant")]],
    ["it is another message", [stored("else")]],
  ])("adds nothing once %s", (_, messages) => {
    expect(withSentSwitch(messages, entry)).toBe(messages);
  });

  it("adds nothing for a send with no switch", () => {
    const messages = [stored("go")];
    expect(withSentSwitch(messages, send([], "go"))).toBe(messages);
  });
});
