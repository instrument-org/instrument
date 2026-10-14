import { describe, expect, it } from "vitest";

import { chatStateOf } from "./chat-state";

const resting = {
  askedAt: undefined,
  failed: false,
  limited: false,
  ownAskedAt: undefined,
  ownTurn: false,
  spokeAt: 1,
  stopped: false,
  tasks: [],
  wakeOnItsWay: false,
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
      "its own turn under way",
      { ownTurn: true },
      { ownWorking: true, state: "working", working: true },
    ],
    [
      "its own turn standing on its own question",
      { askedAt: 5, ownAskedAt: 5, ownTurn: true },
      { ownWorking: false, state: "waiting", working: false },
    ],
    [
      "its own question the user wrote past, while the turn they started runs",
      { askedAt: 3, ownAskedAt: 3, ownTurn: true, spokeAt: 4 },
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
      "a card its own turn raised, while that turn winds down",
      { askedAt: 5, ownTurn: true },
      { ownWorking: true, state: "waiting", working: true },
    ],
    [
      "a card raised after a turn that ended",
      { askedAt: 5 },
      { ownWorking: false, state: "waiting", working: false },
    ],
    [
      "an ask the user spoke past, while the turn they started runs",
      { askedAt: 3, ownTurn: true, spokeAt: 4 },
      { ownWorking: true, state: "working", working: true },
    ],
    [
      "an ask the user spoke past, once that turn is over",
      { askedAt: 3, spokeAt: 4 },
      { ownWorking: false, state: "waiting", working: false },
    ],
    [
      "a wake on its way",
      { wakeOnItsWay: true },
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
    [
      "a turn stopped at a usage limit",
      { limited: true },
      { ownWorking: false, state: "limited", working: false },
    ],
    [
      "an ask over a usage limit",
      { askedAt: 5, limited: true },
      { ownWorking: false, state: "waiting", working: false },
    ],
    [
      "a turn the user stopped",
      { stopped: true },
      { ownWorking: false, state: "stopped", working: false },
    ],
    [
      "the user's Stop after the turn's error",
      { failed: true, stopped: true },
      { ownWorking: false, state: "stopped", working: false },
    ],
    [
      "a task still at work after the user stopped the chat's turn",
      { stopped: true, tasks: [{}] },
      { ownWorking: false, state: "working", working: true },
    ],
    [
      "a card still open after the user stopped the turn",
      { askedAt: 5, stopped: true },
      { ownWorking: false, state: "waiting", working: false },
    ],
  ])("%s", (_name, over, expected) => {
    expect(chatStateOf({ ...resting, ...over })).toEqual(expected);
  });
});
