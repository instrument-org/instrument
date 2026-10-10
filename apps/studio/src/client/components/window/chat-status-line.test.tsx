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

const title = "Lisbon trip";
const idle = { runningTasks: [], state: "idle" as const, title };
const at = (state: "failed" | "waiting" | "working") => ({
  runningTasks: [],
  state,
  title,
});
const done = (
  when: number,
  name = "Lisbon fares and hotels",
  last?: string,
) => ({
  standing: { kind: "done", line: "Here are the fares I found" },
  ...(last ? { step: last } : {}),
  title: name,
  updatedAt: new Date(when),
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
        chat: at("working"),
        isAgentRunning: false,
        listed: [],
        messages: [user(1)],
      },
      { text: "Instrument is working", tone: "run" },
    ],
    [
      "nothing in a chat that has only talked",
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
          title,
        },
        isAgentRunning: false,
        listed: [],
        messages: [user(1), step("Starting a task")],
      },
      { text: "Writing day three", tone: "run" },
    ],
    [
      "a running task's name before it names a step",
      {
        chat: {
          runningTasks: [{ id: taskId, title: "Itinerary" }],
          state: "working",
          title,
        },
        isAgentRunning: false,
        listed: [],
        messages: [user(1), step("Starting a task")],
      },
      { text: "Itinerary", tone: "run" },
    ],
    [
      "what a stalled task needs",
      {
        chat: {
          runningTasks: [
            { id: taskId, title: "Itinerary", waiting: "Needs your dates" },
          ],
          state: "waiting",
          title,
        },
        isAgentRunning: false,
        listed: [],
        messages: [user(1), step("Starting a task")],
      },
      { text: "Needs your dates", tone: "wait" },
    ],
    [
      "the chat's own last step with a check once it is done",
      {
        chat: idle,
        isAgentRunning: false,
        listed: [],
        messages: [user(1), step("Checking fares on flytap.com"), user(6)],
      },
      { text: "Checking fares on flytap.com", tone: "done" },
    ],
    [
      "the task that finished last, after the chat's own step",
      {
        chat: idle,
        isAgentRunning: false,
        listed: [done(5)],
        messages: [user(1), step("Starting a task"), user(6)],
      },
      { text: "Lisbon fares and hotels", tone: "done" },
    ],
    [
      "a task's last step when its name is the chat's",
      {
        chat: idle,
        isAgentRunning: false,
        listed: [done(5, title, "Comparing hotel prices")],
        messages: [user(1), step("Starting a task")],
      },
      { text: "Comparing hotel prices", tone: "done" },
    ],
    [
      "nothing when all there is to say is the chat's title",
      {
        chat: idle,
        isAgentRunning: false,
        listed: [done(5, title)],
        messages: [user(1), step("Starting a task")],
      },
      undefined,
    ],
    [
      "a chat stopped on an error",
      {
        chat: at("failed"),
        isAgentRunning: false,
        listed: [],
        messages: [user(1), step("Starting a task")],
      },
      { text: "Stopped on an error", tone: "failed" },
    ],
  ])("says %s", (_, input, expected) => {
    expect(statusLine(input)).toEqual(expected);
  });
});
