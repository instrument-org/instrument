import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { DeviceIdSchema } from "../../schemas/device-id";
import { type PermissionCard } from "../../schemas/permission-card";
import { cardLine, closeAsk, openCardsIn, recordAsk } from "./asks";
import { openAsks } from "./open-asks";
import { ruleRefusal } from "../permissions/rules-fs";
import { rulesFor } from "../permissions/rules";

const settings = {
  apps: [],
  chats: {},
  topics: {},
  folders: [],
  places: {},
  dangerouslyAllowEveryFolder: false,
};

it("names the folder to ask for, and raises no card itself", async () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("asks-test"));
  const home = os.homedir();
  const rules = {
    ...rulesFor({ home, settings }),
    asker: { chatId, sessionId: StoreId.newSessionId() },
  };
  const refusal = ruleRefusal({
    hostPath: path.join(home, "Documents", "Clients", "a.pdf"),
    op: "read",
    rules,
    spell: (hostPath) =>
      `~/${path.relative(home, hostPath).replaceAll(path.sep, "/")}`,
  });
  expect(refusal).toMatchInlineSnapshot(
    `""~/Documents/Clients/a.pdf" needs the person's yes. If the work needs it, ask for "~/Documents/Clients" with ask_permission."`,
  );
  expect(await openAsks(chatId)).toEqual([]);
});

it("asks once per folder, and a second session joins the card", async () => {
  const chatId = await chatFor();
  const first = StoreId.newSessionId();
  const second = StoreId.newSessionId();
  const target = path.join(os.homedir(), "Desktop");
  await recordAsk(
    { chatId, reason: "To copy it.", sessionId: first },
    "folder",
    target,
  );
  await recordAsk(
    { chatId, reason: "Again.", sessionId: first },
    "folder",
    target,
  );
  await recordAsk(
    { chatId, reason: "To read it.", sessionId: second },
    "folder",
    target,
  );
  const asks = await openAsks(chatId);
  expect(asks).toEqual([
    expect.objectContaining({
      askers: [
        { at: expect.any(Date), reason: "To copy it.", sessionId: first },
        { at: expect.any(Date), reason: "To read it.", sessionId: second },
      ],
      kind: "folder",
      status: "open",
      target,
    }),
  ]);
  expect(await closeAsk(chatId, asks[0]?.id ?? "")).toBeDefined();
  expect(await openAsks(chatId)).toEqual([]);
});

it("stops counting a session as waiting once it asks with a call that ends its turn", async () => {
  const chatId = await chatFor();
  const own = StoreId.newSessionId();
  const target = path.join(os.homedir(), "Downloads");
  const macos = { allowed: "allowed", status: "macos-asking" } as const;
  await recordAsk(
    { chatId, sessionId: own, waits: true },
    "folder",
    target,
    macos,
  );
  expect((await openAsks(chatId))[0]?.askers).toEqual([
    { at: expect.any(Date), sessionId: own, waits: true },
  ]);
  // Its command's watch again: still waiting.
  await recordAsk(
    { chatId, sessionId: own, waits: true },
    "folder",
    target,
    macos,
  );
  expect((await openAsks(chatId))[0]?.askers).toEqual([
    { at: expect.any(Date), sessionId: own, waits: true },
  ]);
  await recordAsk(
    { chatId, reason: "To list it.", sessionId: own },
    "folder",
    target,
    macos,
  );
  expect((await openAsks(chatId))[0]?.askers).toEqual([
    { at: expect.any(Date), reason: "To list it.", sessionId: own },
  ]);
});

it("never asks for the home folder whole", () => {
  const home = os.homedir();
  const refusal = ruleRefusal({
    hostPath: path.join(home, "notes.md"),
    op: "write",
    rules: {
      ...rulesFor({ home, settings }),
      asker: {
        chatId: ChatIdSchema.parse("asks-test"),
        sessionId: StoreId.newSessionId(),
      },
    },
    spell: (hostPath) => hostPath,
  });
  expect(refusal).toMatch(/which can't be asked for whole\./);
});

it.each([
  [
    "folder",
    path.join(os.homedir(), "Pantry"),
    "Waiting for your OK to use “Pantry”",
  ],
  ["app", "Reminders", "Waiting for your OK to use Reminders"],
] as const)("names the %s a card waits on", (kind, target, line) => {
  expect(
    cardLine({
      askedAt: new Date(),
      askers: [],
      id: "ask",
      kind,
      status: "open",
      target,
    }),
  ).toBe(line);
});

describe("openCardsIn", () => {
  const mac = DeviceIdSchema.parse("dev_MAC00000");
  const phone = DeviceIdSchema.parse("dev_PH0NE000");
  const laptop = DeviceIdSchema.parse("dev_1APT0P00");
  const chat = StoreId.newSessionId();
  const task = StoreId.newSessionId();
  const at = (minute: number) => new Date(2026, 9, 30, 9, minute);
  const card: PermissionCard = {
    askedAt: at(0),
    askers: [
      { at: at(0), sessionId: task },
      { at: at(1), sessionId: chat },
    ],
    device: mac,
    id: "card",
    kind: "folder",
    status: "open",
    target: "/Users/me/Pantry",
  };

  it("answers with the first decision in log order, whoever gave it", () => {
    const [open] = openCardsIn({
      answers: [
        { at: at(5), card: "card", decision: "always", device: phone },
        { at: at(4), card: "card", decision: "declined", device: laptop },
      ],
      cards: [card],
    });
    expect(open?.answer).toEqual({
      at: at(5),
      decision: "always",
      device: phone,
      taken: false,
    });
  });

  it("answers with the one the card's computer took over any first in the log", () => {
    const taken = { at: at(6), decision: "declined" as const, device: laptop };
    const [open] = openCardsIn({
      answers: [{ at: at(5), card: "card", decision: "always", device: phone }],
      cards: [{ ...card, answer: taken }],
    });
    expect(open?.answer).toEqual({ ...taken, taken: true });
  });

  it("passes over an answer the card gave up on, and takes the next", () => {
    const failedAnswer = {
      at: at(5),
      card: "card",
      decision: "always" as const,
      device: phone,
    };
    const [open] = openCardsIn({
      answers: [
        failedAnswer,
        { at: at(6), card: "card", decision: "declined", device: laptop },
      ],
      cards: [{ ...card, spent: [{ at: at(5), device: phone }] }],
    });
    expect(open?.answer).toEqual({
      at: at(6),
      decision: "declined",
      device: laptop,
      taken: false,
    });
  });

  /** A Stop by the phone, dated by the phone's clock, naming the entries it saw. */
  const stop = (
    phoneClock: Date,
    entries: { at: Date; sessionId: StoreId.Session }[],
  ) => ({
    askers: entries,
    at: phoneClock,
    card: "card",
    decision: "stopped" as const,
    device: phone,
  });

  it("takes off the card the asker entries a Stop names, and closes it with none left", () => {
    expect(
      openCardsIn({
        answers: [stop(at(2), [{ at: at(0), sessionId: task }])],
        cards: [card],
      })[0]?.card.askers,
    ).toEqual([{ at: at(1), sessionId: chat }]);
    expect(
      openCardsIn({ answers: [stop(at(2), card.askers)], cards: [card] }),
    ).toEqual([]);
  });

  // The phone's clock an hour behind the Mac's: its Stop, made after the
  // ask, is dated before it, and still takes the session off.
  it("honors a Stop from a device whose clock is behind", () => {
    expect(
      openCardsIn({
        answers: [
          stop(new Date(at(0).getTime() - 3_600_000), [
            { at: at(0), sessionId: task },
          ]),
        ],
        cards: [card],
      })[0]?.card.askers,
    ).toEqual([{ at: at(1), sessionId: chat }]);
  });

  // The phone's clock an hour ahead: its Stop is dated after the session
  // asked again, and still leaves the new ask on the card.
  it("keeps a session that asked again after a Stop from a device whose clock is ahead", () => {
    const again = { at: at(9), sessionId: task };
    expect(
      openCardsIn({
        answers: [
          stop(new Date(at(9).getTime() + 3_600_000), [
            { at: at(0), sessionId: task },
          ]),
        ],
        cards: [{ ...card, askers: [again, card.askers[1] ?? again] }],
      })[0]?.card.askers,
    ).toHaveLength(2);
  });

  it("leaves out a closed card", () => {
    expect(
      openCardsIn({ answers: [], cards: [{ ...card, closedAt: at(3) }] }),
    ).toEqual([]);
  });
});
