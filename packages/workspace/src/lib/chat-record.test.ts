import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { chatDir } from "./record-folders";
import {
  getChatState,
  readChatRecord,
  setChatState,
  updateChatRecord,
} from "./chat-record";
import { newDeviceId } from "./records/device-id";
import { getWorkspaceConfig } from "./workspace-config";

const id = ChatIdSchema.parse("task-record-test");

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-record-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  chatId = createMockChatConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { force: true, recursive: true });
});

function heldFileError(code: string): Error {
  return Object.assign(new Error(`${code}: held by another program`), { code });
}

function recordPath(): string {
  return path.join(chatDir(chatId), "settings.json");
}

function statePath(device: string = getWorkspaceConfig().deviceId): string {
  return path.join(chatDir(chatId), `state.${device}.json`);
}

async function writeJson(file: string, record: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

describe("readChatRecord", () => {
  it("answers empty for a chat with no file", async () => {
    const record = await readChatRecord(chatDir(chatId));

    expect(record.settings).toBeUndefined();
    expect(record.raw).toEqual({});
  });

  it("answers empty for a file that is not JSON, rather than throwing", async () => {
    await fs.writeFile(recordPath(), "{ truncated mid-wr", "utf8");

    await expect(readChatRecord(chatDir(chatId))).resolves.toMatchObject({
      settings: undefined,
    });
  });

  it("reports a chat with no file as readable, since a write may create it", async () => {
    const record = await readChatRecord(chatDir(chatId));

    expect(record.unreadable).toBe(false);
  });

  it.each([
    ["truncated JSON", "{ truncated mid-wr"],
    ["JSON that is not an object", "[1, 2, 3]"],
  ])("reports %s as unreadable", async (_name, contents) => {
    await fs.writeFile(recordPath(), contents, "utf8");

    const record = await readChatRecord(chatDir(chatId));

    expect(record.unreadable).toBe(true);
  });
});

describe("updateChatRecord", () => {
  it("carries forward a field it cannot read rather than dropping it", async () => {
    await writeJson(recordPath(), {
      futureField: { written: "by a newer build" },
      createdWithAppVersion: "2.0.0",
    });

    await updateChatRecord(chatDir(chatId), (record) => ({
      ...record.raw,
      createdWithAppVersion: "2.0.1",
    }));

    expect(await readJson(recordPath())).toEqual({
      futureField: { written: "by a newer build" },
      createdWithAppVersion: "2.0.1",
    });
  });

  // What the empty answer to a failed read costs if a write is allowed to build
  // on it: the record read as though the chat had nothing, so the write would
  // have replaced the settings with one field.
  it("refuses to replace a record it could not read", async () => {
    await fs.writeFile(recordPath(), '{ "createdWithAppVersion": "2.0', "utf8");

    await expect(
      updateChatRecord(chatDir(chatId), () => ({ folder: "Trip" })),
    ).rejects.toThrow(/unreadable/);

    expect(await fs.readFile(recordPath(), "utf8")).toBe(
      '{ "createdWithAppVersion": "2.0',
    );
  });

  it("leaves no temporary file behind", async () => {
    await updateChatRecord(chatDir(chatId), () => ({
      createdWithAppVersion: "2.0.0",
    }));

    const entries = await fs.readdir(chatDir(chatId));

    expect(entries).toEqual(["settings.json"]);
  });

  // The file is replaced by a rename, so a reader either sees the whole old one
  // or the whole new one. Nothing observes a half-written record.
  it("never leaves the file partially written", async () => {
    await writeJson(recordPath(), { createdWithAppVersion: "2.0.0" });

    const long = "x".repeat(200_000);
    const reads: Promise<string>[] = [];

    const write = updateChatRecord(chatDir(chatId), (record) => ({
      ...record.raw,
      folder: long,
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

    await updateChatRecord(chatDir(chatId), () => ({ folder: "Landed" }));

    const record = await readChatRecord(chatDir(chatId));

    expect(record.raw.folder).toBe("Landed");
  });

  it("reports a failure that waiting cannot clear, without waiting", async () => {
    const rename = vi
      .spyOn(fs, "rename")
      .mockRejectedValue(heldFileError("EXDEV"));

    await expect(
      updateChatRecord(chatDir(chatId), () => ({ folder: "Lost" })),
    ).rejects.toThrow(/EXDEV/);

    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping updates instead of losing one", async () => {
    await Promise.all([
      updateChatRecord(chatDir(chatId), (record) => ({
        ...record.raw,
        createdWithAppVersion: "2.0.0",
      })),
      updateChatRecord(chatDir(chatId), (record) => ({
        ...record.raw,
        folder: "Drafted",
      })),
    ]);

    const record = await readChatRecord(chatDir(chatId));

    expect(record.settings?.createdWithAppVersion).toBe("2.0.0");
    expect(record.raw.folder).toBe("Drafted");
  });
});

describe("this device's state", () => {
  it("answers empty for a chat with no state file", async () => {
    await expect(getChatState(chatDir(chatId))).resolves.toEqual({
      appGuidesShown: [],
      browserTabs: [],
      waitingOn: [],
    });
  });

  it("is written to this device's own file, never the settings", async () => {
    await writeJson(recordPath(), { createdWithAppVersion: "2.0.0" });

    await setChatState(chatDir(chatId), { appGuidesShown: ["linear"] });

    expect(await readJson(recordPath())).toEqual({
      createdWithAppVersion: "2.0.0",
    });
    expect(await readJson(statePath())).toEqual({
      appGuidesShown: ["linear"],
    });
  });

  // The reason the file is per device: a turn on another computer writes its
  // own state, and this one's tabs and cards stay as they were.
  it("never clobbers another device's state, nor reads it", async () => {
    const other = newDeviceId();
    const theirs = {
      browserTabs: [],
      waitingOn: [
        {
          askedAt: "2026-10-18T12:00:00.000Z",
          askers: [{ sessionId: "ses_01M57YZVESD48Z1K45RY4CKY04" }],
          id: "theirs",
          kind: "folder",
          target: "/Users/someone/Desktop",
        },
      ],
    };
    await writeJson(statePath(other), theirs);

    await setChatState(chatDir(chatId), { appGuidesShown: ["github"] });
    await writeJson(statePath(other), { ...theirs, appGuidesShown: ["x"] });
    await setChatState(chatDir(chatId), { appGuidesShown: ["github", "y"] });

    expect(await getChatState(chatDir(chatId))).toEqual({
      appGuidesShown: ["github", "y"],
      browserTabs: [],
      waitingOn: [],
    });
    expect(await readJson(statePath(other))).toEqual({
      ...theirs,
      appGuidesShown: ["x"],
    });
  });

  it("keeps the settings when the state cannot be read", async () => {
    await writeJson(recordPath(), { createdWithAppVersion: "2.0.0" });
    await writeJson(statePath(), { browserTabs: "not a list at all" });

    expect((await readChatRecord(chatDir(chatId))).settings).toMatchObject({
      createdWithAppVersion: "2.0.0",
    });
    expect(await getChatState(chatDir(chatId))).toEqual({
      appGuidesShown: [],
      browserTabs: [],
      waitingOn: [],
    });
  });

  it("carries forward a field it cannot read", async () => {
    await writeJson(statePath(), { futureNested: "keep me" });

    await setChatState(chatDir(chatId), { appGuidesShown: ["after"] });

    expect(await readJson(statePath())).toEqual({
      appGuidesShown: ["after"],
      futureNested: "keep me",
    });
  });

  it("refuses to replace a state file it could not read", async () => {
    await fs.writeFile(statePath(), '{ "browserTabs": [', "utf8");

    await expect(
      setChatState(chatDir(chatId), { appGuidesShown: ["refused"] }),
    ).rejects.toThrow(/unreadable/);

    expect(await fs.readFile(statePath(), "utf8")).toBe('{ "browserTabs": [');
  });
});

describe("state an earlier build kept in the settings", () => {
  const legacy = {
    appGuidesRead: ["github"],
    asks: [
      {
        askedAt: "2026-10-18T12:00:00.000Z",
        askers: [{ sessionId: "ses_01M57YZVESD48Z1K45RY4CKY04" }],
        id: "ask-1",
        kind: "folder",
        target: "/Users/someone/Desktop",
      },
    ],
    browserTabs: [],
    futureNested: "keep me",
  };

  it("moves into this device's file under the names it has now, once", async () => {
    await writeJson(recordPath(), {
      createdWithAppVersion: "2.0.0",
      state: legacy,
    });

    const state = await getChatState(chatDir(chatId));

    expect(state.appGuidesShown).toEqual(["github"]);
    expect(state.waitingOn.map((ask) => ask.id)).toEqual(["ask-1"]);
    expect(await readJson(recordPath())).toEqual({
      createdWithAppVersion: "2.0.0",
    });
    expect(await readJson(statePath())).toEqual({
      appGuidesShown: ["github"],
      browserTabs: [],
      futureNested: "keep me",
      waitingOn: legacy.asks,
    });
  });

  it("leaves a state file this device already has as it is", async () => {
    await writeJson(recordPath(), { state: legacy });
    await writeJson(statePath(), { appGuidesShown: ["mine"], browserTabs: [] });

    await setChatState(chatDir(chatId), { browserTabs: [] });

    expect(await getChatState(chatDir(chatId))).toEqual({
      appGuidesShown: ["mine"],
      browserTabs: [],
      waitingOn: [],
    });
    expect(await readJson(recordPath())).toEqual({});
  });
});
