import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { WorkspaceDirSchema } from "../schemas/paths";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { withTempDir } from "../test/helpers/temp-dir";
import { windowStatePath } from "./window-paths";
import { getWindowState, updateWindowState } from "./window-state";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { ChatIdSchema } from "../schemas/chat-id";
import { chatFor } from "../test/helpers/chat-record";

const root = withTempDir("window-state");

async function writeFile(contents: string) {
  await fs.mkdir(path.dirname(windowStatePath()), { recursive: true });
  await fs.writeFile(windowStatePath(), contents);
}

async function readFile(): Promise<unknown> {
  return JSON.parse(await fs.readFile(windowStatePath(), "utf8"));
}

describe("window state", () => {
  const session = StoreId.newSessionId();
  const chatId = ChatIdSchema.parse("2026-10-04-lisbon");

  beforeEach(() => {
    createMockTaskConfig(TaskIdSchema.parse("window-state"));
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(root.path),
      tasksDir: WorkspaceDirSchema.parse(path.join(root.path, "tasks")),
    });
  });

  it("keeps a field it cannot read through a write to another", async () => {
    await writeFile(
      JSON.stringify({
        appChats: { linear: chatId },
        chatSeen: { [chatId]: "written by a newer build" },
        futureField: { kept: true },
      }),
    );

    expect((await getWindowState()).appChats).toEqual({ linear: chatId });

    await updateWindowState(() => ({ appChats: {} }));

    expect(await readFile()).toMatchObject({
      appChats: {},
      chatSeen: { [chatId]: "written by a newer build" },
      futureField: { kept: true },
    });
  });

  it("reads a chat a 2.0 beta named by its session as the chat, and writes it so", async () => {
    const named = chatFor(session);
    const gone = StoreId.newSessionId();
    await writeFile(
      JSON.stringify({
        appChats: { gone: gone, linear: session, notion: named },
      }),
    );

    const read = await getWindowState();
    // A chat no longer there is dropped.
    expect(read.appChats).toEqual({ linear: named, notion: named });

    await updateWindowState(() => ({ browserTargetId: undefined }));
    expect(await readFile()).toMatchObject({
      appChats: { linear: named, notion: named },
    });
  });

  it("sets a file that is not JSON aside before starting a fresh one", async () => {
    await writeFile('{"appChats": {"ses_');

    await updateWindowState(() => ({ appChats: { linear: chatId } }));

    expect(await readFile()).toMatchObject({ appChats: { linear: chatId } });
    const folder = await fs.readdir(path.dirname(windowStatePath()));
    const setAside = folder.filter((name) =>
      name.startsWith("window.json.unreadable-"),
    );
    expect(setAside).toHaveLength(1);
    expect(
      await fs.readFile(
        path.join(path.dirname(windowStatePath()), setAside[0] ?? ""),
        "utf8",
      ),
    ).toBe('{"appChats": {"ses_');
  });

  it("refuses to write over a file it cannot open", async () => {
    // A folder where the file belongs fails the read with something other
    // than not-found, the way a permission error does.
    await fs.mkdir(windowStatePath(), { recursive: true });

    await expect(updateWindowState(() => ({ appChats: {} }))).rejects.toThrow();
    expect((await fs.stat(windowStatePath())).isDirectory()).toBe(true);
  });
});
