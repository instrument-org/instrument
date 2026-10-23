import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { updatePermissionSettings } from "./permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";

/**
 * Guards the local patch to just-bash's redirections: a redirect into a place
 * the filesystem refuses fails that one command, as in bash, and the script
 * goes on. Without it the refusal threw out of the whole call, so the output
 * of every command that had already run (and taken effect) was lost, and the
 * commands after it never ran.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
// Both as the shell names them.
let outside: string;
let closed: string;
let chatRoot: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  const result = await bash.exec(command, {
    signal: AbortSignal.timeout(30_000),
  });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.replaceAll(shellPath(tmpDir), "<tmp>"),
    stdout: result.stdout,
  };
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "refused-write-")),
  );
  // Not mounted: outside every folder the chat reaches, so read-only.
  outside = shellPath(path.join(tmpDir, "outside"));
  closed = shellPath(path.join(tmpDir, "closed"));
  chatRoot = path.join(tmpDir, "chats", "test");
  await fs.mkdir(path.join(tmpDir, "outside"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "closed"), { recursive: true });
  await fs.mkdir(chatRoot, { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  // Settings live in the workspace's root, which the mock chats share across
  // test files, so this file keeps its own.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(tmpDir, "workspace")),
  });
  await updatePermissionSettings((settings) => ({
    ...settings,
    folders: [
      {
        addedAt: new Date(),
        level: "never",
        path: AbsolutePathSchema.parse(path.join(tmpDir, "closed")),
      },
    ],
  }));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

it("keeps the output before a redirect outside every folder, and runs what follows", async () => {
  const result = await run(
    `echo before; echo x >> ${outside}/file; echo after rc=$?; echo kept > here.txt`,
  );
  // On Windows the look at the folder ahead of the write is refused too, as
  // for a closed folder below.
  if (process.platform === "win32") {
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "bash: <tmp>/outside/file: Read-only file system
      "<tmp>/outside" needs the person's yes. If the work needs it, ask for "<tmp>/outside" with ask_permission.
      "<tmp>/outside/file" needs the person's yes. If the work needs it, ask for "<tmp>/outside" with ask_permission.
      ",
        "stdout": "before
      after rc=1
      ",
      }
    `);
  } else {
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "bash: <tmp>/outside/file: Read-only file system
      "<tmp>/outside/file" needs the person's yes. If the work needs it, ask for "<tmp>/outside" with ask_permission.
      ",
        "stdout": "before
      after rc=1
      ",
      }
    `);
  }
  await expect(
    fs.readFile(path.join(chatRoot, "here.txt"), "utf8"),
  ).resolves.toBe("kept\n");
});

it("fails a redirect into a closed folder with its refusal note", async () => {
  const result = await run(
    `echo before; echo x > ${closed}/file; echo after rc=$?`,
  );
  // Windows reads nothing outside the folders the shell mounts, so there the
  // look at the folder ahead of the write is refused too, with its own note.
  if (process.platform === "win32") {
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "bash: <tmp>/closed/file: Read-only file system
      "<tmp>/closed" is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.
      "<tmp>/closed/file" is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.
      ",
        "stdout": "before
      after rc=1
      ",
      }
    `);
  } else {
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "bash: <tmp>/closed/file: Read-only file system
      "<tmp>/closed/file" is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.
      ",
        "stdout": "before
      after rc=1
      ",
      }
    `);
  }
});

it("stops on the failed redirect under set -e", async () => {
  const result = await run(
    `set -e; echo before; echo x > ${outside}/file; echo never`,
  );
  if (process.platform === "win32") {
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "bash: <tmp>/outside/file: Read-only file system
      "<tmp>/outside" needs the person's yes. If the work needs it, ask for "<tmp>/outside" with ask_permission.
      "<tmp>/outside/file" needs the person's yes. If the work needs it, ask for "<tmp>/outside" with ask_permission.
      ",
        "stdout": "before
      ",
      }
    `);
  } else {
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "bash: <tmp>/outside/file: Read-only file system
      "<tmp>/outside/file" needs the person's yes. If the work needs it, ask for "<tmp>/outside" with ask_permission.
      ",
        "stdout": "before
      ",
      }
    `);
  }
});

it("reports tee and cp into a refused place and goes on", async () => {
  const result = await run(
    `echo x | tee ${outside}/tee.txt; echo rc=$?; echo hi > copy.txt; cp copy.txt ${closed}/; echo rc=$?`,
  );
  // On Windows cp's look at the closed folder is refused before it copies,
  // as the folder note above says.
  if (process.platform === "win32") {
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "tee: <tmp>/outside/tee.txt: Read-only file system
      cp: cannot safely determine whether 'copy.txt' and '<tmp>/closed' are the same file
      "<tmp>/outside/tee.txt" needs the person's yes. If the work needs it, ask for "<tmp>/outside" with ask_permission.
      "<tmp>/closed" is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.
      ",
        "stdout": "x
      rc=1
      rc=1
      ",
      }
    `);
  } else {
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "tee: <tmp>/outside/tee.txt: Read-only file system
      cp: cannot copy 'copy.txt': EROFS: read-only file system, writeFile '<tmp>/closed/copy.txt'
      "<tmp>/outside/tee.txt" needs the person's yes. If the work needs it, ask for "<tmp>/outside" with ask_permission.
      "<tmp>/closed/copy.txt" is closed in Settings › Permissions. Don't look for another way in; tell the person what you needed it for.
      ",
        "stdout": "x
      rc=1
      rc=1
      ",
      }
    `);
  }
});
