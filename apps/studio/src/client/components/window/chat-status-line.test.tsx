import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { statusLine } from "./chat-status-line";

const chatId = StoreId.newSessionId();

const title = "Lisbon trip";
type ChatAt = Parameters<typeof statusLine>[0]["chat"];
const idle: ChatAt = { runningTasks: [], state: "idle", title };
const at = (state: ChatAt["state"], over: Partial<ChatAt> = {}): ChatAt => ({
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
      "the chat's own last step with a check once it is done",
      {
        chat: at("idle", {
          lastStep: lastStep("Checking fares on flytap.com"),
        }),
        listed: [],
      },
      { text: "Checking fares on flytap.com", tone: "done" },
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
      "the chat's own step when it came after the last task",
      {
        chat: at("idle", { lastStep: lastStep("Booking the hotel", 9) }),
        listed: [done(5)],
      },
      { text: "Booking the hotel", tone: "done" },
    ],
    [
      "a task's last step when its name is the chat's",
      {
        chat: at("idle", { lastStep: lastStep("Starting a task") }),
        listed: [done(5, title, "Comparing hotel prices")],
      },
      { text: "Comparing hotel prices", tone: "done" },
    ],
    [
      "nothing when all there is to say is the chat's title",
      {
        chat: at("idle", { lastStep: lastStep("Starting a task") }),
        listed: [done(5, title)],
      },
      undefined,
    ],
    [
      "a chat stopped on an error",
      { chat: at("failed"), listed: [] },
      { text: "Stopped on an error", tone: "failed" },
    ],
  ])("says %s", (_, input, expected) => {
    expect(statusLine(input)).toEqual(expected);
  });
});
