import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { levelDbKeys, unsnappy } from "./leveldb-keys";

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
}

function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    value >>> 24,
  ];
}

/** A block of entries, each key after the first sharing what it can of the one before, with one restart. */
function block(entries: { key: number[]; value: number[] }[]): number[] {
  const bytes: number[] = [];
  let previous: number[] = [];
  for (const { key, value } of entries) {
    let shared = 0;
    while (shared < previous.length && previous[shared] === key[shared]) {
      shared += 1;
    }
    bytes.push(
      ...varint(shared),
      ...varint(key.length - shared),
      ...varint(value.length),
      ...key.slice(shared),
      ...value,
    );
    previous = key;
  }
  return [...bytes, ...u32(0), ...u32(1)];
}

/** A key as a table keeps it: the user key, then its sequence number and whether it was put (1) or deleted (0). */
function internalKey(key: string, sequence: number, put: boolean): number[] {
  const low = sequence * 256 + (put ? 1 : 0);
  return [
    ...Buffer.from(key, "latin1"),
    ...u32(low % 2 ** 32),
    ...u32(Math.floor(low / 2 ** 32)),
  ];
}

/** A table of one uncompressed data block and its index. */
function table(writes: [key: string, sequence: number, put: boolean][]) {
  const data = block(
    writes.map(([key, sequence, put]) => ({
      key: internalKey(key, sequence, put),
      value: put ? [0x76] : [],
    })),
  );
  const dataWithTrailer = [...data, 0, ...u32(0)];
  const index = block([
    { key: [0xff], value: [...varint(0), ...varint(data.length)] },
  ]);
  const indexOffset = dataWithTrailer.length;
  const footer = [
    ...varint(0),
    ...varint(0),
    ...varint(indexOffset),
    ...varint(index.length),
  ];
  return Buffer.from([
    ...dataWithTrailer,
    ...index,
    0,
    ...u32(0),
    ...footer,
    ...Array.from({ length: 40 - footer.length }, () => 0),
    0x57,
    0xfb,
    0x80,
    0x8b,
    0x24,
    0x75,
    0x47,
    0xdb,
  ]);
}

/** A log of one batch, in a record whole or split over two, as a batch too big for its block is. */
function log(
  sequence: number,
  writes: [key: string, put: boolean][],
  { split = false } = {},
) {
  const batch = [
    ...u32(sequence),
    ...u32(0),
    ...u32(writes.length),
    ...writes.flatMap(([key, put]) => [
      put ? 1 : 0,
      ...varint(key.length),
      ...Buffer.from(key, "latin1"),
      ...(put ? [...varint(1), 0x76] : []),
    ]),
  ];
  const record = (type: number, body: number[]) => [
    ...u32(0),
    body.length & 0xff,
    body.length >> 8,
    type,
    ...body,
  ];
  const half = Math.floor(batch.length / 2);
  return Buffer.from(
    split
      ? [...record(2, batch.slice(0, half)), ...record(4, batch.slice(half))]
      : record(1, batch),
  );
}

describe("unsnappy", () => {
  it("reads literals and copies that overlap what they write", () => {
    // "abc", then six bytes copied from three back, then "d".
    const compressed = Uint8Array.from([
      10, 0x08, 0x61, 0x62, 0x63, 0x09, 0x03, 0x00, 0x64,
    ]);
    expect(Buffer.from(unsnappy(compressed)).toString("latin1")).toBe(
      "abcabcabcd",
    );
  });
});

describe("levelDbKeys", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "leveldb-keys-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  it("keeps the keys with the prefix whose newest write put them", async () => {
    fs.writeFileSync(
      path.join(dir, "000005.ldb"),
      table([
        ["META:https://a.example", 1, true],
        ["META:https://b.example", 2, true],
        ["META:https://c.example", 3, true],
        ["VERSION", 4, true],
        ["_https://a.example\u0000\u0001theme", 5, true],
      ]),
    );
    fs.writeFileSync(
      path.join(dir, "000007.ldb"),
      table([["META:https://c.example", 9, false]]),
    );
    fs.writeFileSync(
      path.join(dir, "000008.log"),
      Buffer.concat([
        log(10, [
          ["META:https://b.example", false],
          ["META:https://d.example", true],
        ]),
        log(12, [["META:https://e.example", true]], { split: true }),
        // A record cut short as it was being written.
        log(13, [["META:https://f.example", true]]).subarray(0, 12),
      ]),
    );
    fs.writeFileSync(path.join(dir, "LOG"), "not a table");

    expect(await levelDbKeys(dir, "META:")).toEqual([
      "META:https://a.example",
      "META:https://d.example",
      "META:https://e.example",
    ]);
  });

  it("reads nothing from a folder that is not there", async () => {
    expect(await levelDbKeys(path.join(dir, "missing"), "META:")).toEqual([]);
  });
});
