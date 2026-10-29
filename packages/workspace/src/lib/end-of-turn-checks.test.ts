import { beforeEach, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { endOfTurnNote, givenEndOfTurnNote } from "./end-of-turn-checks";

const createdAt = new Date("2026-10-21T12:00:00Z");
const DEAD = "Made it.\n\n```files\nsquares.csv\n```";
const FINE = "See [the docs](https://example.com).";

let chatId: ChatId;
let chatSession: StoreId.Session;

beforeEach(async () => {
  chatSession = StoreId.newSessionId();
  chatId = await chatFor(chatSession);
});

function step(
  kind: "assistant" | "user",
  text: string,
  extra: { error?: boolean; finishReason?: "length"; tool?: boolean } = {},
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const meta = {
    createdAt,
    id: StoreId.newPartId(),
    messageId: id,
    sessionId: chatSession,
  };
  const parts: SessionMessagePart.Type[] = [
    { metadata: meta, state: "done", text, type: "text" },
  ];
  if (extra.tool) {
    parts.push({
      input: { command: "ls", explanation: "Listing", yieldMs: 1000 },
      metadata: { ...meta, endedAt: createdAt, id: StoreId.newPartId() },
      output: {
        command: "ls",
        commands: ["ls"],
        durationMs: 0,
        exitCode: 0,
        omittedBytes: 0,
        output: "",
      },
      state: "output-available",
      toolCallId: `call-${id}`,
      type: "tool-bash",
    });
  }
  return kind === "user"
    ? { id, metadata: { createdAt, sessionId: chatSession }, parts, role: kind }
    : {
        id,
        metadata: {
          createdAt,
          finishReason: extra.finishReason ?? "stop",
          modelId: "m",
          providerId: "p",
          sessionId: chatSession,
          ...(extra.error
            ? { error: { kind: "aborted" as const, message: "Aborted" } }
            : {}),
        },
        parts,
        role: kind,
      };
}

const asked = () => step("user", "Make me a CSV.");

describe("endOfTurnNote", () => {
  it.each<[string, () => SessionMessage.WithParts[], boolean]>([
    [
      "a reply naming a file that is not there",
      () => [asked(), step("assistant", DEAD)],
      true,
    ],
    [
      "a reply whose links open",
      () => [asked(), step("assistant", FINE)],
      false,
    ],
    [
      "the dead link written in an earlier step of the turn",
      () => [
        asked(),
        step("assistant", DEAD, { tool: true }),
        step("assistant", "Done."),
      ],
      true,
    ],
    [
      "a step that still calls tools",
      () => [asked(), step("assistant", DEAD, { tool: true })],
      false,
    ],
    [
      "a reply cut off at the output limit",
      () => [asked(), step("assistant", DEAD, { finishReason: "length" })],
      false,
    ],
    [
      "a turn already corrected once",
      () => [asked(), step("assistant", DEAD), step("assistant", DEAD)],
      false,
    ],
    [
      "a correction that looked first and still missed",
      () => [
        asked(),
        step("assistant", DEAD),
        step("assistant", "", { tool: true }),
        step("assistant", DEAD),
      ],
      false,
    ],
    [
      "the retry of a correction that failed",
      () => [
        asked(),
        step("assistant", DEAD),
        step("assistant", "", { error: true }),
      ],
      true,
    ],
    [
      "a dead link from an earlier turn",
      () => [
        asked(),
        step("assistant", DEAD),
        asked(),
        step("assistant", FINE),
      ],
      false,
    ],
    ["the first step of a turn", () => [asked()], false],
  ])("%s", async (_label, messages, expected) => {
    const note = await endOfTurnNote({
      chatId,
      messages: messages(),
      sessionId: chatSession,
    });
    expect(note !== undefined).toBe(expected);
  });

  it("names what opens nothing and asks the chat for a short follow-up", async () => {
    expect(
      await endOfTurnNote({
        chatId,
        messages: [
          asked(),
          step(
            "assistant",
            `${DEAD}\n\n[no stevia](instrument://memory/no-stevia)`,
          ),
        ],
        sessionId: chatSession,
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These links in your reply open nothing:
      - \`squares.csv\`: no file there
      - \`instrument://memory/no-stevia\`: no memory by that name
      Find where each really is, then send one short follow-up of a sentence or two with links that open (a files fence with full paths for files). Say plainly of anything that was not made that it was not. The user already has the rest of your reply, so repeat none of it.
      </instrument-system-note>"
    `);
  });

  it("asks a task for its whole reply again, which is what the chat receives", async () => {
    const note = await endOfTurnNote({
      chatId,
      messages: [asked(), step("assistant", DEAD)],
      sessionId: StoreId.newSessionId(),
    });
    expect(note).toContain("write your reply again whole");
  });

  it("hands the step it asked for, and that step's retry, the note it decided on", async () => {
    const reply = step("assistant", DEAD);
    const note = await endOfTurnNote({
      chatId,
      messages: [asked(), reply],
      sessionId: chatSession,
    });
    expect(note).toBeDefined();
    expect(
      givenEndOfTurnNote({
        messages: [asked(), reply],
        sessionId: chatSession,
      }),
    ).toBe(note);
    expect(
      givenEndOfTurnNote({
        messages: [asked(), reply, step("assistant", "", { error: true })],
        sessionId: chatSession,
      }),
    ).toBe(note);
    expect(
      givenEndOfTurnNote({
        messages: [asked(), step("assistant", FINE)],
        sessionId: chatSession,
      }),
    ).toBeUndefined();
    expect(
      givenEndOfTurnNote({
        messages: [asked(), reply, asked()],
        sessionId: chatSession,
      }),
    ).toBeUndefined();
  });
});
