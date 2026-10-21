import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createMemoryPart, memoryToldByTurn } from "./create-memory-part";
import { forgetMemory, memoryDir, saveMemory } from "./memory/store";
import { chatFor } from "../test/helpers/chat-record";
import { writeMessage } from "../test/helpers/told-history";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const sessionId = StoreId.newSessionId();

// A chat of its own per test: the records hold an open chat by its id, so a
// second chat under one name would still be writing into the folder the test
// before it took away.
let chats = 0;
let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "memory-part-test-"));
  const dir = path.join(root, TASKS_DIR_NAME, `memory-part-${++chats}`);
  await fs.mkdir(dir, { recursive: true });
  chatId = createMockChatConfigForDir(dir);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  // What a chat was last told of memory is read from its session's history,
  // so the chat holds the session before any of it is written.
  await chatFor(sessionId, chatId);
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

/** The note the next message carries, written with it as a turn does. */
async function build() {
  const part = await createMemoryPart({
    createdAt: new Date("2026-09-19T12:00:00.000Z"),
    messageId: StoreId.newMessageId(),
    sessionId,
    chatId,
  });
  await writeMessage(chatId, sessionId, "user", [part]);
  return part;
}

/** A turn of the chat's own that changed memory, told as a turn tells it. */
async function ownTurn(name: string) {
  const memory = await memoryToldByTurn([
    { change: "changed", kind: "memory", name },
  ]);
  await writeMessage(chatId, sessionId, "assistant", [
    {
      data: {
        changes: [{ change: "changed", kind: "memory", name }],
        told: { memory },
      },
      type: "data-setupChanges",
    },
  ]);
}

describe("createMemoryPart", () => {
  it("says nothing to a fresh chat when there is nothing to remember", async () => {
    expect(await build()).toBeUndefined();
  });

  it("tells a chat what memory holds once, then only on a change", async () => {
    await saveMemory(memoryDir(), {
      name: "pacific-time",
      text: "You are on Pacific time.\n\nMornings are best for calls.",
    });

    expect(await build()).toMatchObject({
      data: {
        forgotten: [],
        memories: [
          {
            name: "pacific-time",
            text: "You are on Pacific time.",
          },
        ],
        more: 0,
        sentAt: Date.parse("2026-09-19T12:00:00.000Z"),
        tells: "whole",
      },
      type: "data-memory",
    });
    expect(await build()).toBeUndefined();
  });

  it("tells only what was saved, corrected, or forgotten once the whole has been told", async () => {
    await saveMemory(memoryDir(), { name: "address", text: "Portland." });
    await saveMemory(memoryDir(), { name: "roofer", text: "Dale." });
    await saveMemory(memoryDir(), { name: "stevia", text: "No stevia." });
    await build();

    await saveMemory(memoryDir(), { name: "roofer", text: "Dale at Summit." });
    await saveMemory(memoryDir(), { name: "pacific-time", text: "Pacific." });
    await forgetMemory(memoryDir(), "stevia");

    // Two rows and no more: the address the chat already knows stays out.
    expect(await build()).toMatchObject({
      data: {
        forgotten: ["stevia"],
        memories: [
          { name: "pacific-time", text: "Pacific." },
          { name: "roofer", text: "Dale at Summit." },
        ],
        more: 0,
        tells: "changes",
      },
    });
    expect(await build()).toBeUndefined();
  });

  it("says memory is empty after the last one is forgotten", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await build();

    await forgetMemory(memoryDir(), "one");

    expect(await build()).toMatchObject({
      data: { memories: [], tells: "whole" },
    });
    expect(await build()).toBeUndefined();
  });

  it("stays quiet about a change the chat was told of by its own command", async () => {
    const { memory } = await saveMemory(memoryDir(), {
      name: "one",
      text: "One.",
    });
    await ownTurn(memory.name);

    expect(await build()).toBeUndefined();
  });

  it("still tells a change made elsewhere before the chat's own", async () => {
    await saveMemory(memoryDir(), { name: "address", text: "Portland." });
    await build();

    await saveMemory(memoryDir(), { name: "roofer", text: "Dale." });
    const { memory } = await saveMemory(memoryDir(), {
      name: "pacific-time",
      text: "Pacific.",
    });
    await ownTurn(memory.name);

    expect(await build()).toMatchObject({
      data: {
        forgotten: [],
        memories: [{ name: "roofer", text: "Dale." }],
        tells: "changes",
      },
    });
  });

  it("stays quiet about a memory the chat forgot itself", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await saveMemory(memoryDir(), { name: "two", text: "Two." });
    await build();

    await forgetMemory(memoryDir(), "one");
    await ownTurn("one");

    expect(await build()).toBeUndefined();
  });

  it("tells the whole again once a rollover cut the note that told it", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await build();

    await writeMessage(chatId, sessionId, "assistant", [
      {
        data: { droppedMessages: 2, retainedUserMessages: 0 },
        type: "data-contextRollover",
      },
    ]);

    expect(await build()).toMatchObject({
      data: { memories: [{ name: "one" }], tells: "whole" },
    });
  });

  it("tells the whole again once a rollover cut the whole, though a change since is in the window", async () => {
    await saveMemory(memoryDir(), { name: "one", text: "One." });
    await build();
    await writeMessage(chatId, sessionId, "assistant", [
      {
        data: { droppedMessages: 2, retainedUserMessages: 1 },
        type: "data-contextRollover",
      },
    ]);
    await saveMemory(memoryDir(), { name: "two", text: "Two." });
    // Measured from a window holding no whole note, so it tells the whole.
    expect(await build()).toMatchObject({
      data: {
        // Saved within one second of each other, so in either order.
        memories: expect.arrayContaining([
          expect.objectContaining({ name: "one" }),
          expect.objectContaining({ name: "two" }),
        ]),
        tells: "whole",
      },
    });
    expect(await build()).toBeUndefined();
  });
});
