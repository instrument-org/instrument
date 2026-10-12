import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { callsItOff } from "./mid-turn";

function user(text: string): SessionMessage.UserWithParts {
  const id = StoreId.newMessageId();
  const sessionId = StoreId.newSessionId();
  const createdAt = new Date("2026-10-10T10:00:00.000Z");
  return {
    id,
    metadata: { createdAt, sessionId },
    parts: [
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
    ],
    role: "user",
  };
}

describe("callsItOff", () => {
  it.each([
    "stop",
    "Stop!",
    "stop it.",
    "cancel",
    "cancel that",
    "never mind",
    "Nevermind.",
    "nvm",
    "forget it",
    "forget that!",
    "abort",
    "halt",
    "stop please",
    "Please stop.",
    "ok stop",
    "cancel, please!",
    "ok, never mind",
  ])("stops the turn for %j", (text) => {
    expect(callsItOff(user(text))).toBe(true);
  });

  it.each([
    "stop using tabs, use the API",
    "forget it, I'll do it myself",
    "cancel the second one",
    "stop it and use the API instead",
    "never mind the logo, keep going",
    "Don't stop, but use first names.",
    "unrelated, quick: what's 18% of 240?",
    "Also make them shorter.",
    "please",
    "ok",
  ])("joins the turn for %j", (text) => {
    expect(callsItOff(user(text))).toBe(false);
  });
});
