import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { getTaskPrivateDir } from "./task-dir-utils";
import { chatDir } from "./record-folders";
import { readChatRecord, setChatState, updateChatRecord } from "./chat-record";

const id = ChatIdSchema.parse("task-record-test");

let taskId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-record-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  taskId = createMockChatConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(chatDir(taskId), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { force: true, recursive: true });
});

function heldFileError(code: string): Error {
  return Object.assign(new Error(`${code}: held by another program`), { code });
}

function recordPath(): string {
  return path.join(getTaskPrivateDir(chatDir(taskId)), "settings.json");
}

async function writeRecordFile(record: unknown): Promise<void> {
  await fs.mkdir(getTaskPrivateDir(chatDir(taskId)), { recursive: true });
  await fs.writeFile(recordPath(), JSON.stringify(record, null, 2), "utf8");
}

describe("readChatRecord", () => {
  it("answers empty for a task with no file", async () => {
    const record = await readChatRecord(chatDir(taskId));

    expect(record.settings).toBeUndefined();
    expect(record.state).toEqual({ browserTabs: [] });
    expect(record.raw).toEqual({});
  });

  // The whole reason the two views are parsed apart. A draft or a pane the
  // schema rejects must not cost the task its title and its place in the list.
  it("keeps the settings when the state cannot be read", async () => {
    await writeRecordFile({
      name: "Still named",
      pinnedAt: "2026-01-01T00:00:00.000Z",
      state: { attachedFolders: "not a record at all" },
    });

    const record = await readChatRecord(chatDir(taskId));

    expect(record.settings?.name).toBe("Still named");
    expect(record.state).toEqual({ browserTabs: [] });
  });

  // And the other direction: a title this build cannot read must not silently
  // unmount the folders the agent is allowed to reach.
  it("keeps the state when the settings cannot be read", async () => {
    await writeRecordFile({
      name: { not: "a string" },
      state: { selectedModelURI: "half a sentence" },
    });

    const record = await readChatRecord(chatDir(taskId));

    expect(record.settings).toBeUndefined();
    expect(record.state.selectedModelURI).toBe("half a sentence");
  });

  it("answers empty for a file that is not JSON, rather than throwing", async () => {
    await fs.mkdir(getTaskPrivateDir(chatDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), "{ truncated mid-wr", "utf8");

    await expect(readChatRecord(chatDir(taskId))).resolves.toMatchObject({
      settings: undefined,
    });
  });

  it("reports a task with no file as readable, since a write may create it", async () => {
    const record = await readChatRecord(chatDir(taskId));

    expect(record.unreadable).toBe(false);
  });

  it.each([
    ["truncated JSON", "{ truncated mid-wr"],
    ["JSON that is not an object", "[1, 2, 3]"],
  ])("reports %s as unreadable", async (_name, contents) => {
    await fs.mkdir(getTaskPrivateDir(chatDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), contents, "utf8");

    const record = await readChatRecord(chatDir(taskId));

    expect(record.unreadable).toBe(true);
  });
});

describe("updateChatRecord", () => {
  it("carries forward a field it cannot read rather than dropping it", async () => {
    await writeRecordFile({
      futureField: { written: "by a newer build" },
      name: "Test task",
    });

    await updateChatRecord(chatDir(taskId), "settings", (record) => ({
      ...record.raw,
      name: "Renamed",
    }));

    const written: unknown = JSON.parse(
      await fs.readFile(recordPath(), "utf8"),
    );

    expect(written).toEqual({
      futureField: { written: "by a newer build" },
      name: "Renamed",
    });
  });

  // The half that matters for this: the top level is a closed set, `state` is
  // the one that keeps growing, so it is the one a build rollback meets.
  it("carries forward an unreadable field inside the state too", async () => {
    await writeRecordFile({
      name: "Test task",
      state: { futureNested: "keep me", selectedModelURI: "before" },
    });

    await setChatState(chatDir(taskId), { selectedModelURI: "after" });

    const written: unknown = JSON.parse(
      await fs.readFile(recordPath(), "utf8"),
    );

    expect(written).toEqual({
      name: "Test task",
      state: {
        browserTabs: [],
        futureNested: "keep me",
        selectedModelURI: "after",
      },
    });
  });

  // What the empty answer to a failed read costs if a write is allowed to build
  // on it: the record read as though the task had nothing, so the write would
  // have been the title, the pin and the tabs replaced by one model choice.
  it("refuses to replace a record it could not read", async () => {
    await fs.mkdir(getTaskPrivateDir(chatDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), '{ "name": "Test task", "state', "utf8");

    await expect(
      setChatState(chatDir(taskId), { selectedModelURI: "new draft" }),
    ).rejects.toThrow(/unreadable/);

    expect(await fs.readFile(recordPath(), "utf8")).toBe(
      '{ "name": "Test task", "state',
    );
  });

  // The other half of the same rule: nothing to lose is not the same as
  // something we cannot read, and a task's first write has to land.
  it("creates the record for a task that has no file yet", async () => {
    await setChatState(chatDir(taskId), { selectedModelURI: "first draft" });

    const record = await readChatRecord(chatDir(taskId));

    expect(record.state.selectedModelURI).toBe("first draft");
  });

  it("takes writes again once the unreadable record is repaired", async () => {
    await fs.mkdir(getTaskPrivateDir(chatDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), "{ truncated", "utf8");
    await expect(
      setChatState(chatDir(taskId), { selectedModelURI: "refused" }),
    ).rejects.toThrow();

    await writeRecordFile({ name: "Repaired" });
    await setChatState(chatDir(taskId), { selectedModelURI: "accepted" });

    const record = await readChatRecord(chatDir(taskId));

    expect(record.settings?.name).toBe("Repaired");
    expect(record.state.selectedModelURI).toBe("accepted");
  });

  it("leaves no temporary file behind", async () => {
    await updateChatRecord(chatDir(taskId), "settings", () => ({
      name: "Test task",
    }));

    const entries = await fs.readdir(getTaskPrivateDir(chatDir(taskId)));

    expect(entries).toEqual(["settings.json"]);
  });

  // The file is replaced by a rename, so a reader either sees the whole old one
  // or the whole new one. Nothing observes a half-written record.
  it("never leaves the file partially written", async () => {
    await writeRecordFile({ name: "Test task" });

    const long = "x".repeat(200_000);
    const reads: Promise<string>[] = [];

    const write = updateChatRecord(chatDir(taskId), "settings", (record) => ({
      ...record.raw,
      state: { selectedModelURI: long },
    }));
    for (let index = 0; index < 20; index++) {
      reads.push(fs.readFile(recordPath(), "utf8"));
    }

    await write;
    const contents = await Promise.all(reads);

    for (const content of contents) {
      expect(() => JSON.parse(content) as unknown).not.toThrow();
    }
  });

  // Windows refuses the rename with EPERM for as long as another program holds
  // either file, which a virus scanner or a search indexer does to a file this
  // one is rewritten as often as. Observed there as a channel that would not
  // stay marked read.
  it("waits out a rename another program refused", async () => {
    const rename = fs.rename;
    let refusals = 2;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (refusals > 0) {
        refusals -= 1;
        throw heldFileError("EPERM");
      }
      await rename(from, to);
    });

    await setChatState(chatDir(taskId), { selectedModelURI: "landed" });

    const record = await readChatRecord(chatDir(taskId));

    expect(record.state.selectedModelURI).toBe("landed");
  });

  it("reports a failure that waiting cannot clear, without waiting", async () => {
    const rename = vi
      .spyOn(fs, "rename")
      .mockRejectedValue(heldFileError("EXDEV"));

    await expect(
      setChatState(chatDir(taskId), { selectedModelURI: "lost" }),
    ).rejects.toThrow(/EXDEV/);

    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping updates instead of losing one", async () => {
    await Promise.all([
      updateChatRecord(chatDir(taskId), "settings", (record) => ({
        ...record.raw,
        name: "Named",
      })),
      updateChatRecord(chatDir(taskId), "settings", (record) => ({
        ...record.raw,
        state: { selectedModelURI: "drafted" },
      })),
    ]);

    const record = await readChatRecord(chatDir(taskId));

    expect(record.settings?.name).toBe("Named");
    expect(record.state.selectedModelURI).toBe("drafted");
  });
});
