import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { getChatPrivateDir } from "./chat-dir-utils";
import { chatDir } from "./record-folders";
import { getChatState, setChatState } from "./chat-record";
import { getChatSettings, updateChatSettings } from "./chat-settings";

const id = ChatIdSchema.parse("task-record-state-test");

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-record-state-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  chatId = createMockChatConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function recordFilePath(): string {
  return path.join(getChatPrivateDir(chatDir(chatId)), "settings.json");
}

async function writeStateFile(state: unknown): Promise<void> {
  const privateDir = getChatPrivateDir(chatDir(chatId));
  await fs.mkdir(privateDir, { recursive: true });
  await fs.writeFile(
    recordFilePath(),
    JSON.stringify({ name: "Test task", state }, null, 2),
    "utf8",
  );
}

describe("getChatState", () => {
  it("reads back what it writes", async () => {
    await setChatState(chatDir(chatId), { appGuidesRead: ["github"] });

    const state = await getChatState(chatDir(chatId));

    expect(state.appGuidesRead).toEqual(["github"]);
  });

  // A field this build cannot read is carried forward by the next write
  // rather than dropped by it.
  it("keeps a state field it does not know", async () => {
    await writeStateFile({ fromANewerBuild: true });

    await setChatState(chatDir(chatId), { appGuidesRead: ["github"] });

    const written = await fs.readFile(recordFilePath(), "utf8");
    expect(written).toContain('"fromANewerBuild": true');
  });
});

describe("the state beside the settings", () => {
  /**
   * The state and the task's settings are the same file, so the two write
   * paths have to share one queue. Without it each merges onto the record the
   * other has not written, and whichever lands second erases the other's half.
   */
  it("does not lose a generated title to a state write at the same time", async () => {
    await updateChatSettings(chatId, { name: "Untitled task" });

    await Promise.all([
      updateChatSettings(chatId, { name: "Generated title" }),
      setChatState(chatDir(chatId), { appGuidesRead: ["half a thought"] }),
    ]);

    const settings = await getChatSettings(chatDir(chatId));
    const state = await getChatState(chatDir(chatId));

    expect(settings?.name).toBe("Generated title");
    expect(state.appGuidesRead).toEqual(["half a thought"]);
  });
});
