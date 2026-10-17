import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the local patch to just-bash's `cp`: without `-R`, a source operand
 * that is a symlink is copied as the file it leads to, as POSIX `cp` does.
 * Without the patch `cp` hands the link to `fs.cp`, which copies a link as a
 * link, and no mount we build accepts one: copying macOS's
 * `/System/Library/CoreServices/DefaultDesktop.heic` into the chat's folder
 * failed with `EPERM: operation not permitted, symlink`. Windows has no disk
 * under the mounts for the shell to read a link from, and a folder mount
 * refuses links, so there is nothing of this to run there.
 */
const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let outside: string;
let chatRoot: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  const result = await bash.exec(command, {
    signal: AbortSignal.timeout(30_000),
  });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.replaceAll(tmpDir, "<tmp>"),
    stdout: result.stdout,
  };
}

beforeEach(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "cp-symlink-")),
  );
  // Not mounted: the shell reads it from the disk underneath every mount.
  outside = path.join(tmpDir, "outside");
  chatRoot = path.join(tmpDir, "chats", "test");
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.writeFile(path.join(outside, "real.txt"), "outside bytes");
  await fs.chmod(path.join(outside, "real.txt"), 0o640);
  await fs.symlink("real.txt", path.join(outside, "relative"));
  await fs.symlink(
    path.join(outside, "real.txt"),
    path.join(outside, "absolute"),
  );
  await fs.symlink("gone.txt", path.join(outside, "dangling"));
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot), {
    model,
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

it.skipIf(process.platform === "win32").each(["relative", "absolute"])(
  "cp copies the file behind a link with a %s target into the chat's folder",
  async (link) => {
    const result = await run(
      `cp ${outside}/${link} copy && cp ${outside}/${link} work/`,
    );

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
    for (const copy of ["copy", path.join("work", link)]) {
      const stat = await fs.lstat(path.join(chatRoot, copy));
      expect(stat.isFile()).toBe(true);
      expect((stat.mode & 0o777).toString(8)).toBe("640");
      await expect(
        fs.readFile(path.join(chatRoot, copy), "utf8"),
      ).resolves.toBe("outside bytes");
    }
  },
);

it.skipIf(process.platform === "win32")(
  "names a link to nothing as missing",
  async () => {
    expect(await run(`cp ${outside}/dangling copy`)).toMatchInlineSnapshot(`
    {
      "exitCode": 1,
      "stderr": "cp: cannot stat '<tmp>/outside/dangling': No such file or directory
    ",
      "stdout": "",
    }
  `);
  },
);
