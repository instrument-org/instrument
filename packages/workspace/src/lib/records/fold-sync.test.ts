import { describe, expect, it } from "vitest";

import { type StoreId } from "../../schemas/store-id";
import {
  planDeliveries,
  reallyForked,
  type SessionModel,
  simulateChat,
  type SimulatedChat,
  wholeLines,
} from "./fake-sync";
import { logFileName, parseRecordFileName } from "./file-names";
import { ChatFold, type FoldedSession, foldChat, historyOf } from "./fold";
import { type MarkRecord } from "./record";
import { createRandom, type Random } from "./seeded-random";
import { DEVICE_A, sessionId } from "./test-records";

/**
 * Property tests of the fold against a fake sync engine: devices write a
 * chat between them, and the files reach one more device every way a sync
 * engine can deliver them. Each run is seeded, and a failure names its seed.
 */

const SEEDS = 150;
/** Fewer, since every step of every delivery folds the folder three ways. */
const PARTIAL_SEEDS = 40;

const simulations = new Map<number, SimulatedChat>();

function simulated(seed: number): SimulatedChat {
  const known = simulations.get(seed);
  if (known) {
    return known;
  }
  const chat = simulateChat(createRandom(seed));
  simulations.set(seed, chat);
  return chat;
}

function forEachSeed(count: number, check: (seed: number) => void): void {
  for (let seed = 1; seed <= count; seed++) {
    try {
      check(seed);
    } catch (error) {
      if (error instanceof Error) {
        error.message = `seed ${seed}: ${error.message}`;
      }
      throw error;
    }
  }
}

function filesOf(files: Iterable<[string, Uint8Array]>) {
  return [...files].map(([name, bytes]) => ({ bytes, name }));
}

interface DeliveryState {
  /** Everything delivered so far, evicted files included. */
  delivered: [string, Uint8Array][];
  /** The fold that took each delivery as it came. */
  fold: ChatFold;
  /** What the folder holds now: evicted files read as missing. */
  present: [string, Uint8Array][];
}

/** Delivers a chat's files to a device that only reads, folding each piece as it lands. */
function deliver(
  files: Map<string, Uint8Array>,
  random: Random,
  after?: (state: DeliveryState) => void,
): DeliveryState {
  const fold = new ChatFold();
  const folder = new Map<string, Uint8Array>();
  const evicted = new Set<string>();
  const state = (): DeliveryState => ({
    delivered: [...folder],
    fold,
    present: [...folder].filter(([name]) => !evicted.has(name)),
  });
  for (const delivery of planDeliveries(random, files)) {
    const name = delivery.kind === "copy" ? delivery.copy : delivery.name;
    if (delivery.kind === "evict") {
      evicted.add(name);
    } else if (delivery.kind === "grow" || delivery.kind === "copy") {
      const bytes = (files.get(delivery.name) ?? new Uint8Array()).subarray(
        0,
        delivery.size,
      );
      if ((folder.get(name)?.length ?? -1) < bytes.length) {
        folder.set(name, bytes);
      }
      evicted.delete(name);
    }
    const bytes = folder.get(name);
    if (bytes && !evicted.has(name)) {
      fold.add(name, bytes.subarray(fold.cursor(name).offset));
    }
    after?.(state());
  }
  return state();
}

// Each test walks every seed, which takes a few seconds on a slower machine.
describe("the fold, over a fake sync engine", { timeout: 30_000 }, () => {
  it("comes to the chat its files hold, however they were delivered", () => {
    forEachSeed(SEEDS, (seed) => {
      const { files } = simulated(seed);
      const chat = foldChat(filesOf(files));

      const { fold, present } = deliver(files, createRandom(seed + 10_000));

      expect(fold.chat()).toEqual(chat);
      expect(foldChat(filesOf(present))).toEqual(chat);
    });
  });

  it("folds a partial delivery to what its whole lines hold, and nothing the chat does not", () => {
    forEachSeed(PARTIAL_SEEDS, (seed) => {
      const { files, sessions } = simulated(seed);
      const final = foldChat(filesOf(files));

      deliver(files, createRandom(seed + 20_000), (state) => {
        const partial = foldChat(filesOf(state.present));
        expect(partial).toEqual(foldChat(wholeLines(files, state.present)));
        expect(state.fold.chat()).toEqual(
          foldChat(wholeLines(files, state.delivered)),
        );
        for (const session of partial.sessions) {
          const model = sessions.get(session.id);
          const done = final.sessions.find(({ id }) => id === session.id);
          // A fork only shows once both sides of it have arrived.
          expect(!session.forked || done?.forked).toBe(true);
          for (const { id } of session.messages) {
            expect(model?.messages.has(id)).toBe(true);
            expect(
              model?.retracted.has(id) ||
                done?.messages.some((message) => message.id === id),
            ).toBe(true);
          }
        }
      });
    });
  });

  it("folds to what the devices wrote", () => {
    forEachSeed(SEEDS, (seed) => {
      const { files, marks, sessions } = simulated(seed);
      const chat = foldChat(filesOf(files));

      expect(chat.sessions.map(({ id }) => id)).toEqual(
        [...sessions.keys()].toSorted(),
      );
      for (const session of chat.sessions) {
        const model = sessions.get(session.id);
        if (!model) {
          throw new Error(`The fold made up ${session.id}`);
        }
        expect(session.messages.map(({ id }) => id)).toEqual(
          messageIdsOf(model),
        );
        expect(session.updatedAt.getTime()).toBe(model.updatedAt);
        expect(session.marks).toEqual(marksOf(marks, session.id));
        if (!session.forked) {
          expect(written(session)).toEqual(expectedOf(model));
        }
        if (model.parent && model.forkedAt) {
          const { forkedAt } = model;
          expect(historyOf(chat, session.id).map(({ id }) => id)).toEqual([
            ...messageIdsOf(sessions.get(model.parent)).filter(
              (id) => id <= forkedAt,
            ),
            ...messageIdsOf(model),
          ]);
        }
      }
    });
  });

  it("flags a fork exactly when two devices carried a session on past each other", () => {
    let forks = 0;
    let handOffs = 0;
    forEachSeed(SEEDS, (seed) => {
      const { files, sessions } = simulated(seed);
      for (const session of foldChat(filesOf(files)).sessions) {
        const model = sessions.get(session.id);
        const forked = model ? reallyForked(model) : false;
        expect(session.forked).toBe(forked);
        const writers = new Set(
          model?.events.map(({ stem }) => stem.slice(0, 12)),
        );
        if (forked) {
          forks += 1;
        } else if (writers.size > 1) {
          handOffs += 1;
        }
      }
    });
    // Both cases came up, so neither half of the check passed by default.
    expect(forks).toBeGreaterThan(5);
    expect(handOffs).toBeGreaterThan(5);
  });

  it("never throws, whatever the files hold or are named", () => {
    forEachSeed(SEEDS, (seed) => {
      const random = createRandom(seed + 30_000);
      const { files } = simulated(seed);
      const mangled = [...files].map(([name, bytes]) => ({
        bytes: mangle(random, bytes),
        name: random.chance(0.2) ? `${name.slice(0, -6)}-X.jsonl` : name,
      }));
      const [first] = files.keys();
      const strangers = Array.from({ length: 3 }, (_, index) => ({
        bytes: Buffer.from(
          Array.from({ length: random.int(0, 300) }, () => random.int(0, 255)),
        ),
        name: random.pick([
          first ?? "x",
          `marks.dev_ZZZZZZZ${index}.jsonl`,
          siblingOf(first),
          "settings.json",
        ]),
      }));

      // A name holds one file: a stranger never stands in for one of them.
      const inputs = [
        ...mangled,
        ...strangers.filter(
          (stranger, index) =>
            !mangled.some(({ name }) => name === stranger.name) &&
            strangers.findIndex(({ name }) => name === stranger.name) === index,
        ),
      ];
      const chat = foldChat(inputs);
      const fold = new ChatFold();
      for (const { bytes, name } of random.shuffle(inputs)) {
        let size = 0;
        while (size < bytes.length) {
          size = Math.min(bytes.length, size + random.int(1, 200));
          fold.add(name, bytes.subarray(fold.cursor(name).offset, size));
        }
      }

      expect(fold.chat()).toEqual(chat);
      for (const session of chat.sessions) {
        historyOf(chat, session.id);
      }
      fold.problems();
    });
  });
});

function messageIdsOf(model: SessionModel | undefined): StoreId.Message[] {
  return [...(model?.messages.values() ?? [])]
    .map(({ id }) => id)
    .filter((id) => !model?.retracted.has(id))
    .toSorted();
}

/** What a session's own records come to, written the generator's way. */
function expectedOf(model: SessionModel) {
  const told = Object.fromEntries(
    [...model.told]
      .filter(([, value]) => value !== null && value !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : 1)),
  );
  return {
    messages: messageIdsOf(model).map((id) => ({
      ...model.messages.get(id),
      parts: [...model.parts.values()]
        .filter((part) => part.metadata.messageId === id)
        .toSorted((a, b) => (a.metadata.id < b.metadata.id ? -1 : 1)),
    })),
    rollover: model.rollover,
    stopped: model.stopped,
    told,
  };
}

function written(session: FoldedSession) {
  const { messages, rollover, stopped, told } = session;
  return { messages, rollover, stopped, told };
}

/** The winning mark of each field: settled titles first, then the newest, then the larger device id. */
function marksOf(marks: MarkRecord[], session: StoreId.Session) {
  const winners: Partial<Record<MarkRecord["field"], MarkRecord>> = {};
  const rank = (mark: MarkRecord) =>
    [
      mark.field === "title" && mark.value.settled ? 1 : 0,
      mark.at.getTime(),
      mark.device,
      mark.seq,
    ] as const;
  for (const mark of marks.filter((each) => each.session === session)) {
    const current = winners[mark.field];
    if (!current || compareRanks(rank(mark), rank(current)) > 0) {
      winners[mark.field] = mark;
    }
  }
  return winners;
}

function compareRanks(
  a: readonly (number | string)[],
  b: readonly (number | string)[],
): number {
  for (const [index, left] of a.entries()) {
    const right = b[index];
    if (right !== undefined && left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/** The file with some of its lines broken, lost, repeated, moved or made up. */
function mangle(random: Random, bytes: Uint8Array): Uint8Array {
  const lines = Buffer.from(bytes).toString("latin1").split("\n");
  for (let change = random.int(0, 6); change > 0; change--) {
    const index = random.int(0, lines.length - 1);
    const line = lines[index] ?? "";
    switch (random.int(0, 6)) {
      case 0:
        lines[index] = line.slice(0, random.int(0, line.length));
        break;
      case 1:
        lines.splice(index, 1);
        break;
      case 2:
        lines.splice(index, 0, line);
        break;
      case 3:
        lines.splice(random.int(0, lines.length), 0, ...lines.splice(index, 1));
        break;
      case 4:
        lines[index] = line.replace(
          /"seq":\d+/,
          `"seq":${random.pick([-1, 0, 7, 1e21, 2 ** 53])}`,
        );
        break;
      case 5:
        lines.splice(
          index,
          0,
          random.pick([
            "null",
            "[]",
            "{}",
            '{"t":"session","seq":0}',
            '{"t":"message","seq":5,"at":"2026-10-14T12:00:00.000Z","message":{}}',
            `{"t":"session","seq":0,"at":"2026-10-14T12:00:00.000Z","format":1,"id":"${sessionId(1)}","chat":"x","createdAt":"2026-10-14T12:00:00.000Z","device":"dev_AAAAAAAA","app":"x","continues":{"dev_AAAAAAAA":9007199254740991,"dev_BBBBBBBB":9007199254740991}}`,
          ]),
        );
        break;
      default: {
        const at = random.int(0, line.length);
        lines[index] =
          line.slice(0, at) +
          String.fromCharCode(random.int(0, 255)) +
          line.slice(at + 1);
      }
    }
  }
  return Buffer.from(lines.join("\n"), "latin1");
}

/** Another log of the session and device a file is a log of, or of the tests' own. */
function siblingOf(name: string | undefined): string {
  const parsed = name === undefined ? undefined : parseRecordFileName(name);
  return parsed?.kind === "log"
    ? logFileName(parsed.session, parsed.device, parsed.generation + 1)
    : logFileName(sessionId(1), DEVICE_A, 2);
}
