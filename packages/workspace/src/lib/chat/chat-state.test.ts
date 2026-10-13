import { describe, expect, it } from "vitest";

import { chatStateOf } from "./chat-state";

const resting = {
  failed: false,
  hasAsk: false,
  limited: false,
  ownAlive: false,
  ownAsking: false,
  pendingWake: false,
  tasks: [],
  turnStarting: false,
};

describe("chatStateOf", () => {
  it.each<
    [string, Partial<Parameters<typeof chatStateOf>[0]>, string, boolean]
  >([
    ["nothing moving", {}, "idle", false],
    ["its own agent at work", { ownAlive: true }, "working", true],
    [
      "its own agent stopped on its own ask",
      { hasAsk: true, ownAlive: true, ownAsking: true },
      "waiting",
      false,
    ],
    [
      "a message sent and not yet started",
      { turnStarting: true },
      "working",
      true,
    ],
    ["a task at work", { tasks: [{}] }, "working", false],
    [
      "only a task stopped on an ask",
      { hasAsk: true, tasks: [{ waiting: "Which file?" }] },
      "waiting",
      false,
    ],
    [
      "a task waiting while another works",
      { hasAsk: true, tasks: [{ waiting: "Which file?" }, {}] },
      "working",
      false,
    ],
    ["a wake on its way", { pendingWake: true }, "working", false],
    ["a turn that ended in an error", { failed: true }, "failed", false],
    ["an ask over an error", { failed: true, hasAsk: true }, "waiting", false],
    ["a turn stopped at a usage limit", { limited: true }, "limited", false],
    ["an ask over a usage limit", { hasAsk: true, limited: true }, "waiting", false],
  ])("%s", (_name, over, state, ownWorking) => {
    expect(chatStateOf({ ...resting, ...over })).toEqual({
      ownWorking,
      state,
    });
  });
});
