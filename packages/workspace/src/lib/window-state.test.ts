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

const root = withTempDir("window-state");

async function writeFile(contents: string) {
  await fs.mkdir(path.dirname(windowStatePath()), { recursive: true });
  await fs.writeFile(windowStatePath(), contents);
}

async function readFile(): Promise<unknown> {
  return JSON.parse(await fs.readFile(windowStatePath(), "utf8"));
}

describe("window state", () => {
  const seen = StoreId.newMessageId();
  const session = StoreId.newSessionId();

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
        appChats: { linear: session },
        chatSeen: { [session]: "written by a newer build" },
        futureField: { kept: true },
      }),
    );

    expect((await getWindowState()).appChats).toEqual({ linear: session });

    await updateWindowState(() => ({ appChats: {} }));

    expect(await readFile()).toMatchObject({
      appChats: {},
      chatSeen: { [session]: "written by a newer build" },
      futureField: { kept: true },
    });
  });

  it("sets a file that is not JSON aside before starting a fresh one", async () => {
    await writeFile('{"chatSeen": {"ses_');

    await updateWindowState(() => ({ chatSeen: { [session]: seen } }));

    expect(await readFile()).toMatchObject({ chatSeen: { [session]: seen } });
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
    ).toBe('{"chatSeen": {"ses_');
  });

  it("refuses to write over a file it cannot open", async () => {
    // A folder where the file belongs fails the read with something other
    // than not-found, the way a permission error does.
    await fs.mkdir(windowStatePath(), { recursive: true });

    await expect(updateWindowState(() => ({ chatSeen: {} }))).rejects.toThrow();
    expect((await fs.stat(windowStatePath())).isDirectory()).toBe(true);
  });
});
