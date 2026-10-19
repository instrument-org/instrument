import { isEqual } from "radashi";
import { describe, expect, it } from "vitest";

import { type DeviceId } from "../records/device-id";
import { planDeliveries } from "../records/fake-sync";
import { createRandom, type Random } from "../records/seeded-random";
import { DEVICE_A, DEVICE_B } from "../records/test-records";
import { SyncedFold } from "./synced-fold";
import {
  isSyncedFileName,
  parseSyncedLine,
  recordsFor,
  type SyncedOp,
  type SyncedRecord,
  syncedLine,
} from "./synced-record";

const T0 = Date.parse("2026-10-19T12:00:00.000Z");

/**
 * A device writing its file of a store the way `openSyncedStore` does
 * (`recordsFor` over what it has folded, then a line per record), and
 * folding what it receives of other devices' files.
 */
class Device {
  bytes: Uint8Array = new Uint8Array();
  readonly fold = new SyncedFold();
  readonly id: DeviceId;
  seq = -1;
  /** How far this device's clock is from the true time. */
  readonly skew: number;

  constructor(id: DeviceId, skew = 0) {
    this.id = id;
    this.skew = skew;
  }

  get file(): string {
    return `${this.id}/bookmarks.jsonl`;
  }

  write(ops: SyncedOp[], now: number): SyncedRecord[] {
    const records = recordsFor(
      ops,
      (key) => this.fold.newest(key),
      this.id,
      now + this.skew,
      isEqual,
    ).map((record) => ({ ...record, seq: (this.seq += 1) }));
    this.bytes = Buffer.concat([
      this.bytes,
      Buffer.from(records.map(syncedLine).join("")),
    ]);
    this.fold.add(this.file, this.bytes);
    return records;
  }

  receive(name: string, bytes: Uint8Array): void {
    this.fold.add(name, bytes);
  }

  bookmarks(): Map<string, unknown> {
    return this.fold.entries("bookmark/");
  }
}

describe("synced lines", () => {
  it("writes t, seq and at first and reads its own lines back", () => {
    const record: SyncedRecord = {
      at: new Date(T0),
      device: DEVICE_A,
      key: "bookmark/b1",
      seq: 0,
      t: "set",
      value: { order: 1, title: "Example", url: "https://example.com/" },
    };
    expect(syncedLine(record)).toMatchInlineSnapshot(`
      "{"t":"set","seq":0,"at":"2026-10-19T12:00:00.000Z","device":"dev_AAAAAAAA","key":"bookmark/b1","value":{"order":1,"title":"Example","url":"https://example.com/"}}
      "
    `);
    expect(parseSyncedLine(syncedLine(record))).toEqual(record);
  });

  it.each([
    [
      '{"t":"set","seq":0,"at":"2026-10-19T12:00:00.000Z","device":"dev_AAAAAAAA","key":"k"}',
    ],
    [
      '{"t":"put","seq":0,"at":"2026-10-19T12:00:00.000Z","device":"dev_AAAAAAAA","key":"k","value":1}',
    ],
    ['{"t":"del","seq":0,"at":"yesterday","device":"dev_AAAAAAAA","key":"k"}'],
    [
      '{"t":"del","seq":0,"at":"2026-10-19T12:00:00.000Z","device":"laptop","key":"k"}',
    ],
    [
      '{"t":"del","seq":0,"at":"2026-10-19T12:00:00.000Z","device":"dev_AAAAAAAA","key":""}',
    ],
    ["not json"],
  ])("refuses %s", (line) => {
    expect(parseSyncedLine(line)).toBeUndefined();
  });

  it.each([
    ["bookmarks.jsonl", true],
    ["bookmarks 2.jsonl", true],
    ["bookmarks (Jeremy's conflicted copy 2026-10-19).jsonl", true],
    ["bookmarks-MACBOOK.jsonl", true],
    ["bookmarks.sync-conflict-20261019-120000-ABCD123.jsonl", true],
    ["bookmarks2.jsonl", false],
    ["bookmarks.json", false],
    ["preferences.jsonl", false],
  ])("reads %s as the bookmarks file: %s", (name, expected) => {
    expect(isSyncedFileName(name, "bookmarks")).toBe(expected);
  });
});

describe("SyncedFold", () => {
  it("keeps the newest record of a key, a delete included", () => {
    const a = new Device(DEVICE_A);
    a.write([{ key: "bookmark/b1", t: "set", value: { title: "One" } }], T0);
    a.write([{ key: "bookmark/b1", t: "set", value: { title: "Uno" } }], T0);
    a.write([{ key: "bookmark/b2", t: "set", value: { title: "Two" } }], T0);
    a.write([{ key: "bookmark/b2", t: "del" }], T0 + 1);
    expect(a.bookmarks()).toEqual(new Map([["bookmark/b1", { title: "Uno" }]]));
  });

  it("writes nothing for a change that changes nothing", () => {
    const a = new Device(DEVICE_A);
    a.write([{ key: "k", t: "set", value: { n: 1 } }], T0);
    expect(a.write([{ key: "k", t: "set", value: { n: 1 } }], T0 + 5)).toEqual(
      [],
    );
    expect(a.write([{ key: "gone", t: "del" }], T0 + 5)).toEqual([]);
  });

  it("writes a change made earlier as of then, and not at all over a newer one", () => {
    const a = new Device(DEVICE_A);
    const b = new Device(DEVICE_B);
    // Both import one file, last changed at T0; a removes the bookmark later.
    const imported: SyncedOp = { at: T0, key: "k", t: "set", value: "kept" };
    expect(a.write([imported], T0 + 60_000).map((r) => r.at)).toEqual([
      new Date(T0),
    ]);
    a.write([{ key: "k", t: "del" }], T0 + 60_000);
    b.receive(a.file, a.bytes);
    expect(b.write([imported], T0 + 120_000)).toEqual([]);
    expect(b.fold.entries()).toEqual(new Map());
  });

  it("ties on time go to the larger device id, then the later line", () => {
    const a = new Device(DEVICE_A);
    const b = new Device(DEVICE_B);
    a.write([{ key: "k", t: "set", value: "a" }], T0);
    b.write([{ key: "k", t: "set", value: "b" }], T0);
    a.receive(b.file, b.bytes);
    b.receive(a.file, a.bytes);
    expect(a.fold.entries()).toEqual(new Map([["k", "b"]]));
    expect(b.fold.entries()).toEqual(new Map([["k", "b"]]));
  });

  it("lets a change made here outrank one from a device whose clock runs ahead", () => {
    const ahead = new Device(DEVICE_B, 60_000);
    const here = new Device(DEVICE_A);
    ahead.write([{ key: "k", t: "set", value: "from ahead" }], T0);
    here.receive(ahead.file, ahead.bytes);
    here.write([{ key: "k", t: "set", value: "renamed here" }], T0 + 1000);
    expect(here.fold.entries()).toEqual(new Map([["k", "renamed here"]]));
    ahead.receive(here.file, here.bytes);
    expect(ahead.fold.entries()).toEqual(new Map([["k", "renamed here"]]));
  });

  it("folds a copy of a file once, and a file cut mid-line up to its last whole line", () => {
    const a = new Device(DEVICE_A);
    a.write([{ key: "k", t: "set", value: 1 }], T0);
    a.write([{ key: "k", t: "set", value: 2 }], T0 + 1);
    const reader = new SyncedFold();
    const cut = a.bytes.subarray(0, a.bytes.length - 5);
    expect(reader.add(a.file, cut)).toEqual(new Set(["k"]));
    expect(reader.entries()).toEqual(new Map([["k", 1]]));
    expect(reader.add(`${DEVICE_A}/bookmarks 2.jsonl`, cut)).toEqual(new Set());
    expect(reader.add(a.file, a.bytes)).toEqual(new Set(["k"]));
    expect(reader.entries()).toEqual(new Map([["k", 2]]));
    // Evicted, then back whole: nothing new.
    expect(reader.add(a.file, new Uint8Array())).toEqual(new Set());
    expect(reader.add(a.file, a.bytes)).toEqual(new Set());
  });
});

/**
 * Two devices keep bookmarks between them, each changing what it has heard
 * of the other's while the sync engine between them delivers each file
 * late, in pieces, and cut mid-line. Then both files reach both devices,
 * and a third that only reads, the way a sync engine might: out of order,
 * again, as conflict copies, evicted for a while.
 */
describe("bookmarks kept by two devices", () => {
  const SEEDS = 200;

  /** The newest record of each key across every line written, sorted plainly. */
  function oracle(records: SyncedRecord[]): Map<string, unknown> {
    const newest = new Map<string, SyncedRecord>();
    for (const record of records) {
      const current = newest.get(record.key);
      if (!current || later(record, current)) {
        newest.set(record.key, record);
      }
    }
    return new Map(
      [...newest]
        .filter(([, record]) => record.t === "set")
        .map(([key, record]) => [key, record.t === "set" ? record.value : 0]),
    );
  }

  function later(a: SyncedRecord, b: SyncedRecord): boolean {
    if (a.at.getTime() !== b.at.getTime()) {
      return a.at.getTime() > b.at.getTime();
    }
    if (a.device !== b.device) {
      return a.device > b.device;
    }
    return a.seq > b.seq;
  }

  /** A change a device makes to the bookmarks it has heard of. */
  function change(random: Random, device: Device, step: number): SyncedOp[] {
    const shown = [...device.bookmarks()];
    const action =
      shown.length === 0
        ? "add"
        : random.pick(["add", "rename", "move", "remove", "remove"]);
    if (action === "add") {
      const id = `${device.id}-${step}`;
      return [
        {
          key: `bookmark/${id}`,
          t: "set",
          value: {
            order: shown.length,
            title: `Page ${id}`,
            url: `https://example.com/${id}`,
          },
        },
      ];
    }
    const [key, value] = random.pick(shown);
    if (action === "remove") {
      return [{ key, t: "del" }];
    }
    const bookmark: Record<string, unknown> =
      typeof value === "object" && value !== null ? { ...value } : {};
    if (action === "rename") {
      bookmark.title = `Renamed on ${device.id} at ${step}`;
    } else {
      bookmark.order = random.int(0, 10) + 0.5;
    }
    return [{ key, t: "set", value: bookmark }];
  }

  function run(seed: number) {
    const random = createRandom(seed);
    const devices = [
      new Device(DEVICE_A, random.int(-5000, 5000)),
      new Device(DEVICE_B, random.int(-5000, 5000)),
    ] as const;
    const written: SyncedRecord[] = [];
    let now = T0;
    for (let step = 0; step < random.int(5, 40); step++) {
      now += random.int(0, 3000);
      const writer = random.pick(devices);
      const ops = change(random, writer, step);
      const records = writer.write(ops, now);
      written.push(...records);
      // What a device just did is what it shows.
      for (const op of ops) {
        expect(writer.fold.newest(op.key)?.t).toBe(op.t);
      }
      if (random.chance(0.4)) {
        // The other device hears some of it, maybe cut mid-line.
        const [from, to] =
          writer === devices[0] ? devices : [devices[1], devices[0]];
        to.receive(
          from.file,
          from.bytes.subarray(0, random.int(0, from.bytes.length)),
        );
      }
    }
    const files = new Map(devices.map((device) => [device.file, device.bytes]));
    const [a, b] = devices;
    a.receive(b.file, b.bytes);
    b.receive(a.file, a.bytes);

    const reader = new SyncedFold();
    const folder = new Map<string, Uint8Array>();
    for (const delivery of planDeliveries(random, files)) {
      const bytes = files.get(delivery.name) ?? new Uint8Array();
      switch (delivery.kind) {
        case "grow":
          folder.set(delivery.name, bytes.subarray(0, delivery.size));
          break;
        case "copy":
          folder.set(delivery.copy, bytes.subarray(0, delivery.size));
          break;
        case "evict":
          folder.delete(delivery.name);
          continue;
        case "again":
          break;
      }
      const name = delivery.kind === "copy" ? delivery.copy : delivery.name;
      const present = folder.get(name);
      if (present) {
        reader.add(name, present);
      }
    }
    return { a, b, reader, written };
  }

  it("converge on the same bookmarks, the newest change to each winning", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      try {
        const { a, b, reader, written } = run(seed);
        const expected = oracle(written);
        expect(a.fold.entries()).toEqual(expected);
        expect(b.fold.entries()).toEqual(expected);
        expect(reader.entries()).toEqual(expected);
      } catch (error) {
        if (error instanceof Error) {
          error.message = `seed ${seed}: ${error.message}`;
        }
        throw error;
      }
    }
  });

  it("keep a rename made on one and a remove made on the other, whichever came last", () => {
    const a = new Device(DEVICE_A);
    const b = new Device(DEVICE_B);
    const bookmark = {
      order: 0,
      title: "Docs",
      url: "https://example.com/docs",
    };
    a.write([{ key: "bookmark/x", t: "set", value: bookmark }], T0);
    a.write(
      [{ key: "bookmark/y", t: "set", value: { ...bookmark, order: 1 } }],
      T0,
    );
    b.receive(a.file, a.bytes);
    // Side by side, neither hearing of the other: b renames x and removes y,
    // a removes x a minute later and adds z.
    b.write(
      [
        {
          key: "bookmark/x",
          t: "set",
          value: { ...bookmark, title: "Manual" },
        },
        { key: "bookmark/y", t: "del" },
      ],
      T0 + 1000,
    );
    a.write(
      [
        { key: "bookmark/x", t: "del" },
        { key: "bookmark/z", t: "set", value: { ...bookmark, order: 2 } },
      ],
      T0 + 61_000,
    );
    // Delivered in opposite orders: b's file whole to a, a's file in two
    // pieces to b, the second first.
    a.receive(b.file, b.bytes);
    b.receive(`${DEVICE_A}/bookmarks 2.jsonl`, a.bytes);
    b.receive(a.file, a.bytes.subarray(0, 40));
    expect(a.bookmarks()).toEqual(
      new Map([["bookmark/z", { ...bookmark, order: 2 }]]),
    );
    expect(b.bookmarks()).toEqual(a.bookmarks());
  });
});
