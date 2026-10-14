import { describe, expect, it } from "vitest";

import {
  logFileName,
  marksFileName,
  parseRecordFileName,
  type RecordFileName,
} from "./file-names";
import { DEVICE_A, sessionId } from "./test-records";

const session = sessionId(1);
const log = `${session}.${DEVICE_A}`;

describe("record file names", () => {
  it("names a device's logs and marks", () => {
    expect([
      logFileName(session, DEVICE_A),
      logFileName(session, DEVICE_A, 2),
      marksFileName(DEVICE_A),
    ]).toEqual([`${log}.jsonl`, `${log}.2.jsonl`, `marks.${DEVICE_A}.jsonl`]);
  });

  it.each<[string, RecordFileName]>([
    [`${log}.jsonl`, logName(1)],
    [`${log}.2.jsonl`, logName(2)],
    [`${log}.12.jsonl`, logName(12)],
    [`marks.${DEVICE_A}.jsonl`, { device: DEVICE_A, kind: "marks" }],
  ])("reads %s", (name, expected) => {
    expect(parseRecordFileName(name)).toEqual(expected);
  });

  it.each<[string, string, RecordFileName]>([
    ["iCloud Drive", `${log} 2.jsonl`, logName(1, " 2")],
    ["iCloud Drive, a later log", `${log}.2 3.jsonl`, logName(2, " 3")],
    [
      "Dropbox",
      `${log} (Jeremy's conflicted copy 2026-10-14).jsonl`,
      logName(1, " (Jeremy's conflicted copy 2026-10-14)"),
    ],
    [
      "Dropbox, by case",
      `marks.${DEVICE_A} (Case Conflict).jsonl`,
      { copy: " (Case Conflict)", device: DEVICE_A, kind: "marks" },
    ],
    ["OneDrive", `${log}-JEREMY-PC.jsonl`, logName(1, "-JEREMY-PC")],
    [
      "OneDrive, a Mac's name",
      `marks.${DEVICE_A}-Jeremy's MacBook Pro.jsonl`,
      { copy: "-Jeremy's MacBook Pro", device: DEVICE_A, kind: "marks" },
    ],
    [
      "Syncthing",
      `${log}.3.sync-conflict-20261014-120000-ABCD123.jsonl`,
      logName(3, ".sync-conflict-20261014-120000-ABCD123"),
    ],
    [
      "Syncthing, a copy of a copy",
      `${log}.sync-conflict-20261014-120000-ABCD123.sync-conflict-20261015-090000-EFGH456.jsonl`,
      logName(
        1,
        ".sync-conflict-20261014-120000-ABCD123.sync-conflict-20261015-090000-EFGH456",
      ),
    ],
    ["two engines", `${log} 2-JEREMY-PC.jsonl`, logName(1, " 2-JEREMY-PC")],
  ])("reads a conflict copy from %s", (_engine, name, expected) => {
    expect(parseRecordFileName(name)).toEqual(expected);
  });

  it.each([
    "settings.json",
    "handoff-notes.md",
    `.~sha256-${"0".repeat(64)}.png.tmp`,
    `.${log}.jsonl.icloud`,
    `${log}.jsonl.tmp`,
    `${log}.1.jsonl`,
    `${log}.02.jsonl`,
    `${session}.dev_aaaaaaaa.jsonl`,
    `${session}.dev_AAAAAAAI.jsonl`,
    `ses_123.${DEVICE_A}.jsonl`,
    "marks.jsonl",
    `${log}.jsonl 2`,
  ])("leaves %s alone", (name) => {
    expect(parseRecordFileName(name)).toBeUndefined();
  });
});

function logName(generation: number, copy?: string): RecordFileName {
  return {
    device: DEVICE_A,
    generation,
    kind: "log",
    session,
    stem: generation === 1 ? DEVICE_A : `${DEVICE_A}.${generation}`,
    ...(copy === undefined ? {} : { copy }),
  };
}
