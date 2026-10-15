import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MountedFolder } from "../../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { createBashEnv } from "../create-bash-env";
import { updatePermissionSettings } from "../permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

/**
 * Every command that hands a path to a program on the disk, each naming a
 * file the rules close. A program opens the path it is given whatever the
 * shell makes of that spelling, so a command of this kind resolves its
 * argument before asking the rules, and the two spellings of one file meet
 * the same answer. A new command of this kind belongs here.
 *
 * On Windows the test names the closed file the way the computer names it
 * (`C:\Users\sam\Docs\locked\secret.txt`), which is the spelling the shell
 * makes nothing of; on macOS and Linux there is only the one spelling, and
 * these are plain refusal cases.
 */
const BRIDGING_COMMANDS = [
  {
    command: (named: string) => `rg NEEDLE '${named}'`,
    name: "rg",
    under: "secret.txt",
  },
  {
    command: (named: string) => `rg --file='${named}' .`,
    name: "rg, in a flag's value",
    under: "secret.txt",
  },
  {
    command: (named: string) => `du -sh '${named}'`,
    name: "du",
    under: "secret.txt",
  },
  {
    command: (named: string) => `git init '${named}'`,
    name: "git",
    under: "repo",
  },
] as const;

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let docs: string;
let closed: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({
    folders: {
      Docs: {
        access: "read-write",
        id: MountedFolder.IdSchema.parse("docs-id"),
        path: ChatDirSchema.parse(docs),
      },
    },
    sessionId,
    chatId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeEach(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "host-spelled-")),
  );
  const chatRoot = path.join(tmpDir, "chats", "test");
  docs = path.join(tmpDir, "Docs");
  closed = path.join(docs, "locked");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.mkdir(closed, { recursive: true });
  await fs.writeFile(path.join(closed, "secret.txt"), "NEEDLE closed\n");
  await fs.writeFile(path.join(docs, "note.md"), "NEEDLE in Docs\n");
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot), { model });
  // The rules live in the workspace's machine folder, which the mock chats
  // share across test files, so this file keeps a workspace of its own.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(tmpDir, "workspace")),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(tmpDir, "machine")),
  });
  await updatePermissionSettings((settings) => ({
    ...settings,
    folders: [
      {
        addedAt: new Date(),
        level: "never",
        path: AbsolutePathSchema.parse(closed),
      },
    ],
  }));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("a path spelled the way this computer spells it", () => {
  it.each(BRIDGING_COMMANDS)(
    "$name refuses one the rules close",
    async ({ command, under }) => {
      const result = await run(command(path.join(closed, under)));

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).not.toBe("");
      expect(result.stdout).not.toContain("NEEDLE");
    },
  );

  it("writes nothing where git was refused", async () => {
    const named = path.join(closed, "repo");

    const result = await run(`git init '${named}'`);

    expect(result.exitCode).not.toBe(0);
    await expect(fs.stat(named)).rejects.toThrow();
  });

  it.each([
    { command: (named: string) => `rg NEEDLE '${named}'`, name: "rg" },
    { command: (named: string) => `du -sh '${named}'`, name: "du" },
  ])("$name reads one the rules open", async ({ command }) => {
    const result = await run(command(path.join(docs, "note.md")));

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
