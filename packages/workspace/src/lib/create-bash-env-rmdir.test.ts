import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the just-bash patch for upstream #527: unpatched, `ReadWriteFs` hands
 * a non-recursive `rm` of a directory to Node's `fs.promises.rm`, which refuses
 * every directory with EISDIR, so `rmdir` and `find -delete` fail on every
 * writable mount. Plain `rm` of a directory has to keep failing.
 */
const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let attachedDir: string;
let chatRoot: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({
    folders: {
      Docs: {
        access: "read-write",
        id: MountedFolder.IdSchema.parse("docs-id"),
        path: ChatDirSchema.parse(attachedDir),
      },
    },
    sessionId,
    chatId,
  });
  const result = await bash.exec(command, {
    signal: AbortSignal.timeout(30_000),
  });
  return { exitCode: result.exitCode, stderr: result.stderr };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rmdir-"));
  chatRoot = path.join(tmpDir, "tasks", "test");
  attachedDir = path.join(tmpDir, "Docs");
  await fs.mkdir(path.join(chatRoot, "work", "empty"), { recursive: true });
  await fs.mkdir(path.join(chatRoot, "work", "full"), { recursive: true });
  await fs.writeFile(path.join(chatRoot, "work", "full", "a.txt"), "a");
  await fs.mkdir(path.join(attachedDir, "empty"), { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("rmdir on a writable mount", () => {
  it.each([
    [
      "the chat's folder",
      "work/empty",
      () => path.join(chatRoot, "work", "empty"),
    ],
    [
      "a granted folder",
      () => `${attachedDir}/empty`,
      () => path.join(attachedDir, "empty"),
    ],
  ])("removes an empty directory in %s", async (_, target, hostPath) => {
    const arg = typeof target === "function" ? target() : target;
    expect(await run(`rmdir '${arg}'`)).toEqual({ exitCode: 0, stderr: "" });
    await expect(fs.stat(hostPath())).rejects.toThrow("ENOENT");
  });

  it("removes nested empty directories with -p", async () => {
    await fs.mkdir(path.join(chatRoot, "work", "a", "b"), { recursive: true });

    expect(await run("rmdir -p work/a/b")).toEqual({ exitCode: 0, stderr: "" });
    await expect(fs.stat(path.join(chatRoot, "work", "a"))).rejects.toThrow(
      "ENOENT",
    );
  });

  it("refuses a directory that is not empty", async () => {
    expect(await run("rmdir work/full")).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "rmdir: failed to remove 'work/full': Directory not empty
      ",
      }
    `);
    expect(await fs.readdir(path.join(chatRoot, "work", "full"))).toEqual([
      "a.txt",
    ]);
  });

  it("leaves an empty folder mount's own directory in place", async () => {
    await fs.rm(path.join(attachedDir, "empty"), { recursive: true });

    expect((await run(`rmdir '${attachedDir}'`)).exitCode).toBe(1);
    expect((await fs.stat(attachedDir)).isDirectory()).toBe(true);
  });

  it("lets find -delete remove empty directories", async () => {
    expect(await run("find work/empty -type d -empty -delete")).toEqual({
      exitCode: 0,
      stderr: "",
    });
    await expect(fs.stat(path.join(chatRoot, "work", "empty"))).rejects.toThrow(
      "ENOENT",
    );
  });
});

describe("rm without -r", () => {
  it.each(["work/empty", "DOCS/empty"])(
    "refuses the directory %s",
    async (name) => {
      const target = name.replace("DOCS", attachedDir);
      const result = await run(`rm '${target}'`);
      expect(result).toEqual({
        exitCode: 1,
        stderr: `rm: cannot remove '${target}': Is a directory\n`,
      });
    },
  );
});
