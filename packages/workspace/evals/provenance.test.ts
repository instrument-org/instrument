import { describe, expect, it } from "vitest";

import { Session } from "../src/schemas/session";
import { StoreId } from "../src/schemas/store-id";
import { systemPromptDigest } from "./provenance";

const sessionId = StoreId.SessionSchema.parse("ses_01J00000000000000000000000");

let nextId = 0;
const messageId = () =>
  StoreId.MessageSchema.parse(
    `msg_01J0000000000000000000000${(nextId += 1)}`.slice(0, 30),
  );
const partId = () =>
  StoreId.PartSchema.parse(
    `prt_01J0000000000000000000000${(nextId += 1)}`.slice(0, 30),
  );

const createdAt = new Date("2026-07-24T10:00:01.000Z");

function sessionWith(
  contexts: { realRole: "system" | "user"; text: string }[],
): Session.WithMessagesAndParts {
  return Session.WithMessagesAndPartsSchema.parse({
    createdAt,
    id: sessionId,
    messages: contexts.map(({ realRole, text }) => {
      const id = messageId();
      return {
        id,
        metadata: { agentName: "task", createdAt, realRole, sessionId },
        parts: [
          {
            metadata: { createdAt, id: partId(), messageId: id, sessionId },
            text,
            type: "text",
          },
        ],
        role: "session-context",
      };
    }),
    title: "Digest",
    updatedAt: createdAt,
  });
}

describe("systemPromptDigest", () => {
  it("is stable for the same system prompt", () => {
    const digest = systemPromptDigest([
      sessionWith([{ realRole: "system", text: "You are an assistant." }]),
    ]);
    expect(digest).toMatchInlineSnapshot(
      `"00b00008e83fb08e4fe5fcc4a235591cbf75269c51705c695f5f40b989a47ad7"`,
    );
  });

  it("changes when the prompt changes", () => {
    const before = systemPromptDigest([
      sessionWith([{ realRole: "system", text: "Link files with Markdown." }]),
    ]);
    const after = systemPromptDigest([
      sessionWith([{ realRole: "system", text: "Show files in a fence." }]),
    ]);
    expect(before).not.toBe(after);
  });

  /**
   * The harness context rides in a `session-context` message too, and it holds
   * the model and the task id. Hashing it would give every run its own digest
   * and the field would compare nothing.
   */
  it("ignores context that is not the system prompt", () => {
    const withHarness = systemPromptDigest([
      sessionWith([
        { realRole: "system", text: "You are an assistant." },
        { realRole: "user", text: "Task 2026-08-13-abc, model kimi." },
      ]),
    ]);
    const alone = systemPromptDigest([
      sessionWith([{ realRole: "system", text: "You are an assistant." }]),
    ]);
    expect(withHarness).toBe(alone);
  });

  it("is absent when a session carries no system context", () => {
    expect(systemPromptDigest([sessionWith([])])).toBeUndefined();
  });
});
