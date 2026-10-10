import {
  type SessionMessage,
  type SessionMessagePart,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { statusLine } from "./chat-status-line";

const sessionId = StoreId.newSessionId();
const taskId = TaskIdSchema.parse("lisbon-fares");

function user(at: number, text = "Plan a trip"): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: { createdAt: new Date(at), sessionId },
    parts: [
      {
        metadata: {
          createdAt: new Date(at),
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "user",
  };
}

function step(activity: string): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const part: SessionMessagePart.Type = {
    input: { activity, command: "ls", explanation: "Listing", yieldMs: 1000 },
    metadata: {
      createdAt: new Date(2),
      id: StoreId.newPartId(),
      messageId: id,
      sessionId,
    },
    state: "input-available",
    toolCallId: `call-${id}`,
    type: "tool-bash",
  };
  return {
    id,
    metadata: {
      createdAt: new Date(2),
      finishReason: "tool-calls",
      modelId: "m",
      providerId: "p",
      sessionId,
    },
    parts: [part],
    role: "assistant",
  };
}

const idle = { runningTasks: [], state: "idle" as const };
const done = (at: number) => ({
  standing: { kind: "done" },
  title: "Lisbon fares and hotels",
  updatedAt: new Date(at),
});

describe("statusLine", () => {
  it.each<[string, Parameters<typeof statusLine>[0], unknown]>([
    [
      "the chat's own step while its turn runs",
      {
        chat: idle,
        isAgentRunning: true,
        listed: [],
        messages: [user(1), step("Checking fares on flytap.com")],
      },
      { text: "Checking fares on flytap.com", tone: "run" },
    ],
    [
      "the plain line before a turn names a step",
      {
        chat: { runningTasks: [], state: "working" },
        isAgentRunning: false,
        listed: [],
        messages: [user(1)],
      },
      { text: "Instrument is working", tone: "run" },
    ],
    [
      "nothing for a message nothing went on to answer",
      { chat: idle, isAgentRunning: false, listed: [], messages: [user(1)] },
      undefined,
    ],
    [
      "never the last turn's step in a new one",
      {
        chat: idle,
        isAgentRunning: true,
        listed: [],
        messages: [user(1), step("Reading the old notes"), user(3, "Now this")],
      },
      { text: "Instrument is working", tone: "run" },
    ],
    [
      "a running task's step once the chat is at rest",
      {
        chat: {
          runningTasks: [
            { id: taskId, step: "Writing day three", title: "Itinerary" },
          ],
          state: "working",
        },
        isAgentRunning: false,
        listed: [],
        messages: [user(1), step("Starting a task")],
      },
      { text: "Writing day three", tone: "run" },
    ],
    [
      "what a stalled task needs",
      {
        chat: {
          runningTasks: [
            { id: taskId, title: "Itinerary", waiting: "Needs your dates" },
          ],
          state: "waiting",
        },
        isAgentRunning: false,
        listed: [],
        messages: [user(1), step("Starting a task")],
      },
      { text: "Needs your dates", tone: "wait" },
    ],
    [
      "a task finished since the user last wrote",
      {
        chat: idle,
        isAgentRunning: false,
        listed: [done(5)],
        messages: [user(1), step("Starting a task")],
      },
      { text: "Lisbon fares and hotels", tone: "done" },
    ],
    [
      "nothing once the user has written since it finished",
      {
        chat: idle,
        isAgentRunning: false,
        listed: [done(5)],
        messages: [user(1), step("Starting a task"), user(6), step("Done")],
      },
      undefined,
    ],
  ])("says %s", (_, input, expected) => {
    expect(statusLine(input)).toEqual(expected);
  });
});
