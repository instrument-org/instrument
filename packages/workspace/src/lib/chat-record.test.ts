import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { type HeldTab } from "../schemas/chat-state";
import { StoreId } from "../schemas/store-id";
import { BrowserTargetIdSchema } from "../types";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { chatDir } from "./record-folders";
import { getChatState, setChatState } from "./chat-record";
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
  await fs.rm(root, { force: true, recursive: true });
});

function statePath(device: string = getWorkspaceConfig().deviceId): string {
  return path.join(chatDir(chatId), `state.${device}.json`);
}

async function writeJson(file: string, record: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
}

/** A tab the chat holds, as the state file keeps one. */
function heldTab(): HeldTab {
  return {
    id: BrowserTargetIdSchema.parse(StoreId.newTabId()),
    inWindow: true,
    openedBy: "handed",
  };
}

const tabA = heldTab();
const tabB = heldTab();
const tabC = heldTab();
const tabD = heldTab();
const tabE = heldTab();
const tabF = heldTab();

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

describe("this device's state", () => {
  it("answers empty for a chat with no state file", async () => {
    await expect(getChatState(chatDir(chatId))).resolves.toEqual({
      browserTabs: [],
      closedTabs: [],
    });
  });

  it("is written to this device's own file", async () => {
    await setChatState(chatDir(chatId), { browserTabs: [tabA] });

    expect(await readJson(statePath())).toEqual({
      browserTabs: [tabA],
    });
  });

  // The reason the file is per device: a turn on another computer writes its
  // own state, and this one's tabs stay as they were.
  it("never clobbers another device's state, nor reads it", async () => {
    const other = newDeviceId();
    const theirs = {
      browserTabs: [],
      closedTabs: [
        {
          id: "tab_01M57YZVESD48Z1K45RY4CKY04",
          reason: "tabCap",
          url: "https://example.com/",
        },
      ],
    };
    await writeJson(statePath(other), theirs);

    await setChatState(chatDir(chatId), { browserTabs: [tabB] });
    await writeJson(statePath(other), { ...theirs, browserTabs: [tabC] });
    await setChatState(chatDir(chatId), { browserTabs: [tabB, tabD] });

    expect(await getChatState(chatDir(chatId))).toEqual({
      browserTabs: [tabB, tabD],
      closedTabs: [],
    });
    expect(await readJson(statePath(other))).toEqual({
      ...theirs,
      browserTabs: [tabC],
    });
  });

  it("answers empty for a state it cannot read", async () => {
    await writeJson(statePath(), { browserTabs: "not a list at all" });

    expect(await getChatState(chatDir(chatId))).toEqual({
      browserTabs: [],
      closedTabs: [],
    });
  });

  it("carries forward a field it cannot read", async () => {
    await writeJson(statePath(), { futureNested: "keep me" });

    await setChatState(chatDir(chatId), { browserTabs: [tabE] });

    expect(await readJson(statePath())).toEqual({
      browserTabs: [tabE],
      futureNested: "keep me",
    });
  });

  it("refuses to replace a state file it could not read", async () => {
    await fs.writeFile(statePath(), '{ "browserTabs": [', "utf8");

    await expect(
      setChatState(chatDir(chatId), { browserTabs: [tabF] }),
    ).rejects.toThrow(/unreadable/);

    expect(await fs.readFile(statePath(), "utf8")).toBe('{ "browserTabs": [');
  });
});
