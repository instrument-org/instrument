import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TOOL_SAY_PARAM_NAME } from "../constants";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { BaseInputSchema, toolInputSchemaForLLM } from "../tools/base";
import { type FirstLineMode } from "../types";
import {
  AFTER_FIRST_LINE_NOTE,
  firstLineContinues,
  firstLineStep,
  NUDGE_NOTE,
  sayOf,
  TOOLS_OFF_NOTE,
  TURN_NOTE,
  turnSoFar,
} from "./first-line";
import { systemNoteBody } from "./system-note";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const sessionId = StoreId.newSessionId();
const createdAt = new Date("2026-10-07T12:00:00Z");

function message(
  role: "assistant" | "user",
  parts: ("text" | "tool" | "wake")[],
  extra: { error?: boolean } = {},
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const meta = () => ({
    createdAt,
    id: StoreId.newPartId(),
    messageId: id,
    sessionId,
  });
  const built = parts.map((kind): SessionMessagePart.Type => {
    switch (kind) {
      case "text": {
        return { metadata: meta(), state: "done", text: "Hi.", type: "text" };
      }
      case "tool": {
        return {
          input: { command: "ls", explanation: "Listing", yieldMs: 1000 },
          metadata: { ...meta(), endedAt: createdAt },
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
        };
      }
      case "wake": {
        return {
          data: {
            events: [
              {
                status: "done",
                taskId: TaskIdSchema.parse("lisbon-hotel"),
                title: "Lisbon hotel",
              },
            ],
          },
          metadata: meta(),
          type: "data-taskEvent",
        };
      }
    }
  });
  return role === "user"
    ? { id, metadata: { createdAt, sessionId }, parts: built, role }
    : {
        id,
        metadata: {
          createdAt,
          finishReason: "stop",
          modelId: "m",
          providerId: "p",
          sessionId,
          ...(extra.error
            ? { error: { kind: "aborted" as const, message: "Aborted" } }
            : {}),
        },
        parts: built,
        role,
      };
}

describe("first line", () => {
  const asked = message("user", ["text"]);

  it.each<
    [
      string,
      SessionMessage.WithParts[],
      FirstLineMode,
      ReturnType<typeof firstLineStep>,
    ]
  >([
    [
      "tools-off: the first step of a turn the user started",
      [asked],
      "tools-off",
      { note: TOOLS_OFF_NOTE, takesSay: false, toolChoice: "none" },
    ],
    [
      "tools-off: the step after the text-only first one",
      [asked, message("assistant", ["text"])],
      "tools-off",
      { note: AFTER_FIRST_LINE_NOTE, takesSay: false },
    ],
    [
      "tools-off: a later step",
      [asked, message("assistant", ["text"]), message("assistant", ["tool"])],
      "tools-off",
      { takesSay: false },
    ],
    [
      "tools-off: a failed attempt does not count as the first step",
      [asked, message("assistant", [], { error: true })],
      "tools-off",
      { note: TOOLS_OFF_NOTE, takesSay: false, toolChoice: "none" },
    ],
    [
      "tools-off: a turn a finished task started",
      [message("user", ["wake"])],
      "tools-off",
      { takesSay: false },
    ],
    [
      "nudge: first tool results back with nothing said",
      [asked, message("assistant", ["tool"])],
      "nudge",
      { note: NUDGE_NOTE, takesSay: false },
    ],
    [
      "nudge: first tool results back after a line",
      [asked, message("assistant", ["text", "tool"])],
      "nudge",
      { takesSay: false },
    ],
    [
      "nudge: only once a turn",
      [asked, message("assistant", ["tool"]), message("assistant", ["tool"])],
      "nudge",
      { takesSay: false },
    ],
    [
      "turn-note: the first step of a turn the user started",
      [asked],
      "turn-note",
      { note: TURN_NOTE, takesSay: false },
    ],
    [
      "turn-note: a later step",
      [asked, message("assistant", ["tool"])],
      "turn-note",
      { takesSay: false },
    ],
    [
      "turn-note: a turn a finished task started",
      [message("user", ["wake"])],
      "turn-note",
      { takesSay: false },
    ],
    [
      "preamble: no step is sent differently",
      [asked],
      "preamble",
      { takesSay: false },
    ],
    [
      "say: nothing said yet",
      [asked, message("assistant", ["tool"])],
      "say",
      { takesSay: true },
    ],
    [
      "say: the turn already said something",
      [asked, message("assistant", ["text", "tool"])],
      "say",
      { takesSay: false },
    ],
  ])("%s", (_, messages, mode, expected) => {
    expect(firstLineStep(mode, turnSoFar(messages))).toEqual(expected);
  });

  it("runs a step with tools after tools-off's text-only first step, and only then", () => {
    const after = (...messages: SessionMessage.WithParts[]) =>
      firstLineContinues("tools-off", turnSoFar([asked, ...messages]));
    expect(after(message("assistant", ["text"]))).toBe(true);
    expect(after(message("assistant", []))).toBe(true);
    expect(
      after(message("assistant", ["text"]), message("assistant", [])),
    ).toBe(false);
    expect(after(message("assistant", ["tool"]))).toBe(false);
    expect(
      firstLineContinues(
        "nudge",
        turnSoFar([asked, message("assistant", ["text"])]),
      ),
    ).toBe(false);
  });

  it.each([
    [{ say: "  On it.  " }, "On it."],
    [{ say: "" }, undefined],
    [{ say: 3 }, undefined],
    [{ command: "ls" }, undefined],
    ["text", undefined],
  ])("reads the say of %j", (input, expected) => {
    expect(sayOf(input)).toBe(expected);
  });

  it("asks turn-note's turn for one sentence, then quiet until the outcome", () => {
    expect(systemNoteBody(TURN_NOTE)).toMatchInlineSnapshot(
      `"Before using any tool, write one sentence to the user about what you'll do, then nothing more until the outcome. If no tool is needed, just answer."`,
    );
  });

  it("offers say first, and as required, to the one agent under the say mode alone", async () => {
    const schema = BaseInputSchema.extend({
      filePath: z.string().meta({ description: "The file." }),
    });
    const config = getWorkspaceConfig();
    const properties = async (
      firstLineMode: FirstLineMode | undefined,
      agentName: "instrument-one" | "main",
    ) => {
      setWorkspaceConfig({
        ...config,
        firstLineMode: () => firstLineMode,
        oneAgentMode: () => "fork-only",
      });
      try {
        const json = await asSchema(toolInputSchemaForLLM(schema, agentName))
          .jsonSchema;
        return {
          names: Object.keys(json.properties ?? {}),
          required: json.required,
        };
      } finally {
        setWorkspaceConfig(config);
      }
    };
    const offered = await properties("say", "instrument-one");
    expect(offered.names[0]).toBe(TOOL_SAY_PARAM_NAME);
    expect(offered.required?.[0]).toBe(TOOL_SAY_PARAM_NAME);
    expect((await properties("say", "main")).names).not.toContain(
      TOOL_SAY_PARAM_NAME,
    );
    expect(await properties("nudge", "instrument-one")).toEqual(
      await properties(undefined, "instrument-one"),
    );
    expect((await properties(undefined, "instrument-one")).names).toEqual([
      "activity",
      "explanation",
      "filePath",
    ]);
  });
});
