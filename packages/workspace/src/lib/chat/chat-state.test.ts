import { describe, expect, it } from "vitest";

import { chatStateOf } from "./chat-state";

const resting = {
  askedAt: undefined,
  failed: false,
  ownAlive: false,
  ownAsking: false,
  pendingWake: false,
  spokeAt: 1,
  tasks: [],
  turnStarting: false,
};

describe("chatStateOf", () => {
  it.each<
    [
      string,
      Partial<Parameters<typeof chatStateOf>[0]>,
      ReturnType<typeof chatStateOf>,
    ]
  >([
    [
      "nothing moving",
      {},
      { ownWorking: false, state: "idle", working: false },
    ],
    [
      "its own agent at work",
      { ownAlive: true },
      { ownWorking: true, state: "working", working: true },
    ],
    [
      "its own agent stopped on its own ask",
      { askedAt: 5, ownAlive: true, ownAsking: true },
      { ownWorking: false, state: "waiting", working: false },
    ],
    [
      "a message sent and not yet started",
      { turnStarting: true },
      { ownWorking: true, state: "working", working: true },
    ],
    [
      "a task at work",
      { tasks: [{}] },
      { ownWorking: false, state: "working", working: true },
    ],
    [
      "only a task stopped on an ask",
      { askedAt: 5, tasks: [{ waiting: "Which file?" }] },
      { ownWorking: false, state: "waiting", working: false },
    ],
    [
      "a task waiting while another works",
      { askedAt: 5, tasks: [{ waiting: "Which file?" }, {}] },
      { ownWorking: false, state: "waiting", working: true },
    ],
    [
      "a card its own agent raised, while the turn that met it winds down",
      { askedAt: 5, ownAlive: true },
      { ownWorking: true, state: "waiting", working: true },
    ],
    [
      "a card raised after a turn that ended",
      { askedAt: 5 },
      { ownWorking: false, state: "waiting", working: false },
    ],
    [
      "an ask the user spoke past, while the turn they started runs",
      { askedAt: 3, ownAlive: true, spokeAt: 4 },
      { ownWorking: true, state: "working", working: true },
    ],
    [
      "an ask the user spoke past, once that turn is over",
      { askedAt: 3, spokeAt: 4 },
      { ownWorking: false, state: "waiting", working: false },
    ],
    [
      "a wake on its way",
      { pendingWake: true },
      { ownWorking: false, state: "working", working: true },
    ],
    [
      "a turn that ended in an error",
      { failed: true },
      { ownWorking: false, state: "failed", working: false },
    ],
    [
      "an ask over an error",
      { askedAt: 5, failed: true },
      { ownWorking: false, state: "waiting", working: false },
    ],
  ])("%s", (_name, over, expected) => {
    expect(chatStateOf({ ...resting, ...over })).toEqual(expected);
  });
});
