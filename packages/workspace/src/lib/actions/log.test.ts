import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActionLog } from "./log";

let dir: string;
let now: number;
let log: ActionLog;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "action-log-"));
  now = new Date(2026, 10, 5, 14, 0, 0).getTime();
  log = new ActionLog(dir, { now: () => now });
});

afterEach(() => {
  log.close();
  fs.rmSync(dir, { force: true, recursive: true });
});

describe("ActionLog", () => {
  it("reads back what it wrote, oldest first, within the window", async () => {
    log.record({ kind: "folder", path: "/Users/mac-user/Downloads" });
    now += 60_000;
    log.record({ kind: "edit", path: "/Users/mac-user/Downloads/a.md" });
    now += 60_000;
    log.record({ id: "c1", kind: "chat", title: "Kitchen remodel quotes" });
    const all = await log.read({ since: now - 10 * 60_000 });
    expect(all.map((each) => each.kind)).toEqual(["folder", "edit", "chat"]);
    const last = await log.read({ since: now - 30_000 });
    expect(last.map((each) => each.kind)).toEqual(["chat"]);
  });

  it("is on disk before record returns, so a message sent right after reads it", async () => {
    log.record({ kind: "edit", path: "/Users/mac-user/notes.md" });
    const [file] = fs.readdirSync(dir);
    expect(file).toBe("2026-11-05.jsonl");
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, file ?? ""), "utf8")),
    ).toEqual({
      at: new Date(now).toISOString(),
      kind: "edit",
      path: "/Users/mac-user/notes.md",
    });
  });

  it("leaves out a repeat of the line before within a minute", async () => {
    log.record({ kind: "screen", name: "Apps" });
    now += 10_000;
    log.record({ kind: "screen", name: "Apps" });
    now += 70_000;
    log.record({ kind: "screen", name: "Apps" });
    expect(await log.read({ since: 0 })).toHaveLength(2);
  });

  it("caps a kind at 60 a minute and says how many it left out", async () => {
    for (let index = 0; index < 100; index++) {
      log.record({ kind: "edit", path: `/Users/mac-user/${index}.md` });
    }
    now += 60_000;
    log.record({ kind: "screen", name: "Apps" });
    const read = await log.read({ since: 0 });
    expect(read.filter((each) => each.kind === "edit")).toHaveLength(60);
    expect(read.find((each) => each.kind === "capped")).toMatchObject({
      dropped: 40,
      of: "edit",
    });
  });

  it("reads across midnight from both days' files", async () => {
    now = new Date(2026, 10, 5, 23, 50).getTime();
    log.record({ kind: "folder", path: "/a" });
    now = new Date(2026, 10, 6, 0, 10).getTime();
    log.record({ kind: "folder", path: "/b" });
    expect(fs.readdirSync(dir).toSorted()).toEqual([
      "2026-11-05.jsonl",
      "2026-11-06.jsonl",
    ]);
    const read = await log.read({ since: now - 30 * 60_000 });
    expect(read.map((each) => each.kind === "folder" && each.path)).toEqual([
      "/a",
      "/b",
    ]);
  });

  it("keeps old days until the folder is full, then drops the oldest", () => {
    log.close();
    log = new ActionLog(dir, { maxTotalBytes: 1000, now: () => now });
    for (const day of ["2025-01-01", "2026-10-21", "2026-10-22"]) {
      fs.writeFileSync(path.join(dir, `${day}.jsonl`), "x".repeat(400));
    }
    log.record({ kind: "screen", name: "Apps" });
    expect(fs.readdirSync(dir).toSorted()).toEqual([
      "2026-10-21.jsonl",
      "2026-10-22.jsonl",
      "2026-11-05.jsonl",
    ]);
  });

  it("pages newest first across days, saying when older ones are left", async () => {
    for (const [day, hour] of [
      [3, 9],
      [4, 9],
      [5, 9],
      [5, 10],
    ] as const) {
      now = new Date(2026, 10, day, hour).getTime();
      log.record({ kind: "screen", name: `${day} ${hour}` });
    }
    const page = async (skip: number) =>
      log.newestFirst({ limit: 2, since: 0, skip, until: now });
    const first = await page(0);
    expect(
      first.actions.map((each) => each.kind === "screen" && each.name),
    ).toEqual(["5 10", "5 9"]);
    expect(first.more).toBe(true);
    const second = await page(2);
    expect(
      second.actions.map((each) => each.kind === "screen" && each.name),
    ).toEqual(["4 9", "3 9"]);
    expect(second.more).toBe(false);
  });

  it("clears every day", async () => {
    log.record({ kind: "screen", name: "Apps" });
    await log.clear();
    expect(fs.readdirSync(dir)).toEqual([]);
    log.record({ kind: "screen", name: "Skills" });
    expect(await log.read({ since: 0 })).toHaveLength(1);
  });
});
