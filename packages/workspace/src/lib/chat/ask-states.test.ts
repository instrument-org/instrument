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
    });
    expect(state?.pending).toMatchObject({ decision: "declined" });
  });

  it("has nothing pending once an answer is taken, but a later no", () => {
    const taken = folder({
      answer: { ...yes(phone, 5), ...yes(phone, 5).given },
      is: "taken",
    });
    expect(
      askStates({ answers: [yes(phone, 5), yes(laptop, 6)], asks: [taken] })[0]
        ?.pending,
    ).toBeUndefined();
    expect(
      askStates({ answers: [yes(phone, 5), no(laptop, 6)], asks: [taken] })[0]
        ?.pending,
    ).toMatchObject({ decision: "declined", device: laptop });
  });

  it("takes stopped askers off, and an ask nobody is left on stops being live", () => {
    const stop = (sessionId: typeof own, minute: number): AskAnswer => ({
      ask: "pantry",
      at: at(9),
      device: phone,
      given: { askers: [{ at: at(minute), sessionId }], kind: "stopped" },
    });
    expect(seen({ answers: [stop(task, 0)], asks: [folder()] }))
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
    expect(seen({ answers: [stop(own, 7)], asks: [folder()] })[0]?.askers)
      .toMatchInlineSnapshot(`
        [
          "task",
          "own",
        ]
      `);
    expect(seen({ answers: [stop(task, 0), stop(own, 1)], asks: [folder()] }))
      .toMatchInlineSnapshot(`
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
      }),
    ).toMatchObject([{ live: false, pending: undefined }]);
  });

  it("lets what the person wrote since move past an open question, never a permission", () => {
    const question: AskRecord = {
      askedAt: at(0),
      askers: [{ at: at(0), partId: StoreId.newPartId(), sessionId: own }],
      device: owner,
      id: "q",
      kind: "question",
      messageId: StoreId.newMessageId(),
      partId: StoreId.newPartId(),
      questions: ["Which pantry?"],
      stage: { is: "open" },
    };
    expect(
      askStates({
        answers: [],
        asks: [question, folder()],
        movedPastAt: at(3),
      }).map(({ ask, live }) => `${ask.kind} ${String(live)}`),
    ).toMatchInlineSnapshot(`
      [
        "question false",
        "permission true",
      ]
    `);
  });
});
