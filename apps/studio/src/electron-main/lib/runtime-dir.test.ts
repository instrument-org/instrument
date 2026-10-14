import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRuntimeDir, removeFormerRuntime } from "./runtime-dir";

let userDataDir = "";

vi.mock("electron", () => ({
  app: { getPath: () => userDataDir },
}));

async function plant(...files: string[]) {
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(userDataDir, file)), {
      recursive: true,
    });
    await fs.writeFile(path.join(userDataDir, file), "");
  }
}

describe("removeFormerRuntime", () => {
  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-dir-"));
    return () => fs.rm(userDataDir, { force: true, recursive: true });
  });

  it("deletes what the runtime folder holds now from the root of userData, and nothing else", async () => {
    await plant(
      "bin/node",
      "node-tools/npmrc",
      "sandbox/closed-file",
      "skills/pdf/SKILL.md",
      "skills.preparing-4242/pdf/SKILL.md",
      "skills.previous-4242/pdf/SKILL.md",
      "uv/python/cpython-3.12/bin/python3",
      "uv/cache/CACHEDIR.TAG",
      "indexes/index.db",
      "runtime/bin/node",
      "runtime/skills/pdf/SKILL.md",
      "skills-notes.txt",
      "workspace/chats/a/chat.db",
      "workspaces.json",
    );

    await removeFormerRuntime();

    expect(
      (await fs.readdir(userDataDir, { recursive: true }))
        .map((entry) => entry.replaceAll("\\", "/"))
        .toSorted(),
    ).toMatchInlineSnapshot(`
      [
        "indexes",
        "indexes/index.db",
        "runtime",
        "runtime/bin",
        "runtime/bin/node",
        "runtime/skills",
        "runtime/skills/pdf",
        "runtime/skills/pdf/SKILL.md",
        "skills-notes.txt",
        "workspace",
        "workspace/chats",
        "workspace/chats/a",
        "workspace/chats/a/chat.db",
        "workspaces.json",
      ]
    `);
    expect(getRuntimeDir()).toBe(path.join(userDataDir, "runtime"));
  });

  it("does nothing where there is nothing to delete", async () => {
    await expect(
      removeFormerRuntime(path.join(userDataDir, "missing")),
    ).resolves.toBeUndefined();
  });
});
