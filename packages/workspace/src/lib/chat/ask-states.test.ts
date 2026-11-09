import { describe, expect, it } from "vitest";

import { type AskAnswer, type AskRecord } from "../../schemas/ask";
import { DeviceIdSchema } from "../../schemas/device-id";
import { StoreId } from "../../schemas/store-id";
import { askStates } from "./ask-states";

const owner = DeviceIdSchema.parse("dev_0WNER000");
const phone = DeviceIdSchema.parse("dev_PH0NE000");
const laptop = DeviceIdSchema.parse("dev_1APT0P00");
const own = StoreId.newSessionId();
const task = StoreId.newSessionId();
const at = (minute: number) => new Date(Date.UTC(2026, 9, 31, 12, minute));
const NOW = at(10).getTime();

function folder(stage: AskRecord["stage"] = { is: "open" }): AskRecord {
  return {
    askedAt: at(0),
    askers: [
      { at: at(0), sessionId: task },
      { at: at(1), sessionId: own },
    ],
    device: owner,
    id: "pantry",
    kind: "permission",
    on: "folder",
    stage,
    target: "/Users/me/Pantry",
  };
}

const yes = (device: typeof owner, minute: number): AskAnswer => ({
  ask: "pantry",
  at: at(minute),
  device,
  given: { decision: "allowed", kind: "permission" },
});
const no = (device: typeof owner, minute: number): AskAnswer => ({
  ask: "pantry",
  at: at(minute),
  device,
  given: { decision: "declined", kind: "permission" },
});

/** Each state as a line a reader can compare at a glance. */
function seen(...args: Parameters<typeof askStates>) {
  return askStates(...args).map(({ askers, live, pending }) => ({
    askers: askers.map((asker) => (asker.sessionId === own ? "own" : "task")),
    live,
    pending: pending && `${pending.device} ${JSON.stringify(pending)}`,
  }));
}

describe("askStates", () => {
  it("takes the first answer in log order, whichever device gave it", () => {
    const [state] = askStates({
      answers: [yes(phone, 5), no(laptop, 2)],
      asks: [folder()],
      now: NOW,
    });
    expect(state?.pending).toEqual({
      at: at(5),
      decision: "allowed",
      device: phone,
      kind: "permission",
    });
  });

  it("passes over a spent answer to the next one given", () => {
    const [state] = askStates({
      answers: [yes(phone, 5), no(laptop, 2)],
      asks: [{ ...folder(), spent: [{ at: at(5), device: phone }] }],
      now: NOW,
    });
    expect(state?.pending).toMatchObject({ decision: "declined" });
  });

  it("has nothing pending once an answer is taken, but a later no on its own computer", () => {
    const taken = folder({
      answer: {
        at: at(5),
        decision: "allowed",
        device: phone,
        kind: "permission",
      },
      is: "taken",
    });
    expect(
      askStates({
        answers: [yes(phone, 5), yes(laptop, 6)],
        asks: [taken],
        now: NOW,
      })[0]?.pending,
    ).toBeUndefined();
    expect(
      askStates({
        answers: [yes(phone, 5), no(laptop, 6)],
        asks: [taken],
        now: NOW,
      })[0]?.pending,
    ).toBeUndefined();
    // The no that counts is given where the system's prompt is.
    expect(
      askStates({
        answers: [yes(phone, 5), no(owner, 6)],
        asks: [taken],
        now: NOW,
      })[0]?.pending,
    ).toMatchObject({ decision: "declined", device: owner });
  });

  it("takes stopped askers off, and an ask nobody is left on stops being live", () => {
    const stop = (sessionId: typeof own, minute: number): AskAnswer => ({
      ask: "pantry",
      at: at(9),
      device: phone,
      given: { askers: [{ at: at(minute), sessionId }], kind: "stopped" },
    });
    expect(seen({ answers: [stop(task, 0)], asks: [folder()], now: NOW }))
      .toMatchInlineSnapshot(`
      [
        {
          "askers": [
            "own",
          ],
          "live": true,
          "pending": undefined,
        },
      ]
    `);
    // A Stop naming an entry from another moment names a different ask.
    expect(
      seen({ answers: [stop(own, 7)], asks: [folder()], now: NOW })[0]?.askers,
    ).toMatchInlineSnapshot(`
        [
          "task",
          "own",
        ]
      `);
    expect(
      seen({
        answers: [stop(task, 0), stop(own, 1)],
        asks: [folder()],
        now: NOW,
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "askers": [],
          "live": false,
          "pending": undefined,
        },
      ]
    `);
  });

  it("reads a closed ask as not live, whatever answers came after", () => {
    expect(
      seen({
        answers: [no(phone, 9)],
        asks: [
          folder({
            is: "closed",
            outcome: { kind: "left" },
            woken: true,
          }),
        ],
        now: NOW,
      }),
    ).toMatchObject([{ live: false, pending: undefined }]);
  });

  it("takes no answer given longer ago than an ask stays fresh, and keeps the newest as given while away", () => {
    const [state] = askStates({
      answers: [yes(phone, 1), no(laptop, 2)],
      asks: [folder()],
      now: at(30).getTime(),
    });
    expect(state?.pending).toBeUndefined();
    expect(state?.away).toMatchObject({ decision: "declined", device: laptop });
    // A fresh answer given since is taken over a stale one before it.
    const [later] = askStates({
      answers: [yes(phone, 1), no(laptop, 25)],
      asks: [folder()],
      now: at(30).getTime(),
    });
    expect(later?.pending).toMatchObject({ device: laptop });
    expect(later?.away).toBeUndefined();
  });

  it("lets what the person wrote since move past an open question, never a permission", () => {
    const asked = StoreId.newMessageId();
    const question: AskRecord = {
      askedAt: at(0),
      askers: [{ at: at(0), partId: StoreId.newPartId(), sessionId: own }],
      device: owner,
      id: "q",
      kind: "question",
      messageId: asked,
      partId: StoreId.newPartId(),
      questions: ["Which pantry?"],
      stage: { is: "open" },
    };
    expect(
      askStates({
        answers: [],
        asks: [question, folder()],
        movedPast: { typed: StoreId.newMessageId() },
        now: NOW,
      }).map(({ ask, live }) => `${ask.kind} ${String(live)}`),
    ).toMatchInlineSnapshot(`
      [
        "question false",
        "permission true",
      ]
    `);
  });

  it.each([
    { name: "a later turn's set, from another computer", set: "second" },
    { name: "a question an earlier build asked later", set: undefined },
  ])("leaves a question behind once a later message asks $name", ({ set }) => {
    const question = (
      id: string,
      device: typeof owner,
      messageId: StoreId.Message,
      ofSet: string | undefined,
    ): AskRecord => ({
      askedAt: at(0),
      askers: [{ at: at(0), sessionId: own }],
      device,
      id,
      kind: "question",
      messageId,
      partId: StoreId.newPartId(),
      questions: [id],
      ...(ofSet && { set: ofSet }),
      stage: { is: "open" },
    });
    const earlier = StoreId.newMessageId();
    const sameTurn = StoreId.newMessageId();
    const later = StoreId.newMessageId();

    expect(
      askStates({
        answers: [],
        asks: [
          question("planet", owner, earlier, "first"),
          question("moon", owner, sameTurn, "first"),
          question("again", laptop, later, set),
        ],
        now: NOW,
      }).map(({ ask, live }) => [ask.id, live]),
    ).toEqual([
      ["planet", false],
      ["moon", false],
      ["again", true],
    ]);
    expect(
      askStates({
        answers: [],
        asks: [
          question("planet", owner, earlier, "first"),
          question("moon", owner, sameTurn, "first"),
        ],
        now: NOW,
      }).map(({ ask, live }) => [ask.id, live]),
    ).toEqual([
      ["planet", true],
      ["moon", true],
    ]);
  });
});
