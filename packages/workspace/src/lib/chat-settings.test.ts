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

const id = ChatIdSchema.parse("task-settings-test");

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-settings-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  chatId = createMockChatConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("updateChatSettings", () => {
  it("keeps both fields when two updates overlap", async () => {
    await updateChatSettings(chatId, { createdWithAppVersion: "2.0.0" });

    // Read-modify-write without a queue loses whichever wrote first.
    const activityAt = new Date("2026-02-03T04:05:06.000Z");
    await Promise.all([
      updateChatSettings(chatId, { createdWithAppVersion: "2.0.1" }),
      updateChatSettings(chatId, { lastActivityAt: activityAt }),
    ]);

    const settings = await getChatSettings(chatDir(chatId));

    expect(settings?.createdWithAppVersion).toBe("2.0.1");
    expect(settings?.lastActivityAt).toEqual(activityAt);
  });

  it("applies overlapping updates to the same field in call order", async () => {
    const [first, second] = await Promise.all([
      updateChatSettings(chatId, { createdWithAppVersion: "2.0.1" }),
      updateChatSettings(chatId, { createdWithAppVersion: "2.0.2" }),
    ]);

    const settings = await getChatSettings(chatDir(chatId));

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(settings?.createdWithAppVersion).toBe("2.0.2");
  });

  // The two views share one file, so each has to leave the other's half alone.
  it("leaves the state alone", async () => {
    await setChatState(chatDir(chatId), { appGuidesRead: ["half typed"] });

    await updateChatSettings(chatId, { createdWithAppVersion: "2.0.1" });

    const state = await getChatState(chatDir(chatId));
    const settings = await getChatSettings(chatDir(chatId));

    expect(state.appGuidesRead).toEqual(["half typed"]);
    expect(settings?.createdWithAppVersion).toBe("2.0.1");
  });

  it("survives a state half the schema cannot read", async () => {
    await updateChatSettings(chatId, { createdWithAppVersion: "2.0.0" });
    await fs.writeFile(
      path.join(getChatPrivateDir(chatDir(chatId)), "settings.json"),
      JSON.stringify({
        createdWithAppVersion: "2.0.0",
        state: { browserTabs: "broken" },
      }),
      "utf8",
    );

    const stamped = await updateChatSettings(chatId, {
      lastActivityAt: new Date("2026-02-03T04:05:06.000Z"),
    });
    const settings = await getChatSettings(chatDir(chatId));

    expect(stamped.isOk()).toBe(true);
    expect(settings?.createdWithAppVersion).toBe("2.0.0");
    expect(settings?.lastActivityAt).toEqual(
      new Date("2026-02-03T04:05:06.000Z"),
    );
  });

  // The settings view is parsed as one object, so a single unreadable field
  // takes the whole view with it. Every activity stamp writes through this, so
  // a write that fills the gap with what it parsed erases the settings of any
  // chat a newer build -- or a hand edit -- left one bad field in.
  it("keeps the fields a malformed sibling makes unreadable", async () => {
    const recordPath = path.join(
      getChatPrivateDir(chatDir(chatId)),
      "settings.json",
    );
    await fs.mkdir(getChatPrivateDir(chatDir(chatId)), { recursive: true });
    await fs.writeFile(
      recordPath,
      JSON.stringify({
        createdWithAppVersion: "2.0.0",
        reasoningEffort: "loud",
      }),
      "utf8",
    );

    const stamped = await updateChatSettings(chatId, {
      lastActivityAt: new Date("2026-02-03T04:05:06.000Z"),
    });

    expect(stamped.isOk()).toBe(true);
    expect(JSON.parse(await fs.readFile(recordPath, "utf8"))).toEqual({
      lastActivityAt: "2026-02-03T04:05:06.000Z",
      createdWithAppVersion: "2.0.0",
      reasoningEffort: "loud",
    });
  });
});
