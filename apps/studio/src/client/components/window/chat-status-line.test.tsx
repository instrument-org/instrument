import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { statusLine } from "./chat-status-line";

const chatId = StoreId.newSessionId();

const title = "Lisbon trip";
type ChatAt = Parameters<typeof statusLine>[0]["chat"];
const idle: ChatAt = {
  lastUserMessageAt: 1,
  runningTasks: [],
  state: "idle",
  title,
};
const at = (state: ChatAt["state"], over: Partial<ChatAt> = {}): ChatAt => ({
  lastUserMessageAt: 1,
  runningTasks: [],
  state,
  title,
  ...over,
});
/** What the chat's record says its turn or a task is on. */
const onStep = (text: string) => ({ at: 2, kind: "step" as const, text });
/** The chat's own last labeled step. */
const lastStep = (text: string, when = 2) => ({ at: when, text });
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
const failed = (when: number, name: string, last: string) => ({
  ...done(when, name, last),
  standing: { kind: "failed", line: "The site would not load" },
});

describe("statusLine", () => {
  it.each<[string, Parameters<typeof statusLine>[0], unknown]>([
    [
      "the step its record names while it works",
      {
        chat: at("working", { latest: onStep("Checking fares on flytap.com") }),
        listed: [],
      },
      { text: "Checking fares on flytap.com", tone: "run" },
    ],
    [
      "the plain line before a turn names a step",
      {
        chat: at("working", {
          latest: { at: 1, kind: "reply", text: "Sure." },
        }),
        listed: [],
      },
      { text: "Instrument is working", tone: "run" },
    ],
    [
      "nothing in a chat that has only talked",
      { chat: idle, listed: [] },
      undefined,
    ],
    [
      "what a stalled task needs",
      {
        chat: at("waiting", {
          runningTasks: [
            { id: chatId, title: "Itinerary", waiting: "Needs your dates" },
          ],
        }),
        listed: [],
      },
      { text: "Needs your dates", tone: "wait" },
    ],
    [
      "that the chat waits on the user",
      { chat: at("waiting"), listed: [] },
      { text: "Waiting on you", tone: "wait" },
    ],
    [
      "that a card waits on the user, rather than the step that met it",
      {
        chat: at("waiting", {
          lastStep: lastStep("Reading the AWS configuration"),
          latest: {
            at: 3,
            kind: "question",
            text: "Waiting for your OK to use “.aws”",
          },
        }),
        listed: [],
      },
      { text: "Waiting on you", tone: "wait" },
    ],
    [
      "that its own work is done, rather than the step it was on",
      {
        chat: at("idle", {
          lastStep: lastStep("Checking fares on flytap.com"),
        }),
        listed: [],
      },
      { text: "Done", tone: "done" },
    ],
    [
      "the task that finished last, after the chat's own step",
      {
        chat: at("idle", { lastStep: lastStep("Starting a task") }),
        listed: [done(5)],
      },
      { text: "Lisbon fares and hotels", tone: "done" },
    ],
    [
      "that its own work is done when that came after the last task",
      {
        chat: at("idle", { lastStep: lastStep("Booking the hotel", 9) }),
        listed: [done(5)],
      },
      { text: "Done", tone: "done" },
    ],
    [
      "that a task named like the chat is done, rather than its last step",
      {
        chat: at("idle", { lastStep: lastStep("Starting a task") }),
        listed: [done(5, title, "Comparing hotel prices")],
      },
      { text: "Done", tone: "done" },
    ],
    [
      "that a task named like the chat is done, with no step to its name",
      {
        chat: at("idle", { lastStep: lastStep("Starting a task") }),
        listed: [done(5, title)],
      },
      { text: "Done", tone: "done" },
    ],
    [
      "the step a task named like the chat stopped on",
      {
        chat: at("idle", { lastStep: lastStep("Starting a task") }),
        listed: [failed(5, title, "Comparing hotel prices")],
      },
      { text: "Comparing hotel prices", tone: "stopped" },
    ],
    [
      "a chat stopped on an error",
      { chat: at("failed"), listed: [] },
      { text: "Stopped on an error", tone: "failed" },
    ],
    [
      "that its work is done once the user wrote after the task they stopped, though its reply took no step",
      {
        chat: at("idle", {
          lastStep: lastStep("Running the requested waits"),
          lastUserMessageAt: 10,
        }),
        listed: [{ ...done(5), stoppedBy: "user" }],
      },
      { text: "Done", tone: "done" },
    ],
    [
      "a task that woke the chat by name after the reply it woke, until the user writes",
      {
        chat: at("idle", {
          lastStep: lastStep("Starting a task"),
          lastUserMessageAt: 1,
        }),
        listed: [done(5)],
      },
      { text: "Lisbon fares and hotels", tone: "done" },
    ],
    [
      "nothing for the task the user stopped last, not a check",
      {
        chat: at("idle", { lastStep: lastStep("Starting a task") }),
        listed: [{ ...done(5), stoppedBy: "user" }],
      },
      undefined,
    ],
    [
      "nothing for the task the chat stopped last, not a check",
      {
        chat: at("idle", { lastStep: lastStep("Stopping the waiting task") }),
        listed: [{ ...done(5), stoppedBy: "chat" }],
      },
      undefined,
    ],
    [
      "nothing for a task named like the chat that the chat stopped",
      {
        chat: at("idle", { lastStep: lastStep("Stopping the waiting task") }),
        listed: [{ ...done(5, title), stoppedBy: "chat" }],
      },
      undefined,
    ],
    [
      "nothing once the user stopped it, rather than that it is done",
      {
        chat: at("stopped", {
          lastStep: lastStep("Listing the Documents folder"),
        }),
        listed: [done(1)],
      },
      undefined,
    ],
  ])("says %s", (_, input, expected) => {
    expect(statusLine(input)).toEqual(expected);
  });
});
