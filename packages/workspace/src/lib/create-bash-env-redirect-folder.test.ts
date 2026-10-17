import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the just-bash patch that lets a redirect into a folder that does
 * not exist fail, as in bash. Unpatched, the filesystem made the folder: a
 * path split at its spaces (`echo x >> "Support/Instrument"`) left
 * `Support/` in the work folder at exit 0, and nothing told the agent the
 * path was wrong.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let chatRoot: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  const result = await bash.exec(command, {
    signal: AbortSignal.timeout(30_000),
  });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "redirect-folder-")),
  );
  chatRoot = path.join(tmpDir, "chats", "test");
  await fs.mkdir(path.join(chatRoot, "made"), { recursive: true });
  await fs.writeFile(path.join(chatRoot, "file"), "");
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

it.each([
  'echo x >> "Support/Instrument"',
  'echo x > "Support/Instrument"',
  'ls 2> "Support/Instrument"',
])("fails %s without making the folder", async (command) => {
  expect(await run(`${command}; echo "rc=$?"`)).toEqual({
    exitCode: 0,
    stderr: "bash: Support/Instrument: No such file or directory\n",
    stdout: "rc=1\n",
  });
  expect(existsSync(path.join(chatRoot, "Support"))).toBe(false);
});

it("reads a file in the way as not a folder", async () => {
  expect(await run('echo x > file/f; echo "rc=$?"')).toEqual({
    exitCode: 0,
    stderr: "bash: file/f: Not a directory\n",
    stdout: "rc=1\n",
  });
});

it("still writes into a folder that exists, and to /dev/null", async () => {
  expect(
    await run(
      "echo x > made/f; echo y >> made/f; echo z > /dev/null; cat made/f",
    ),
  ).toEqual({ exitCode: 0, stderr: "", stdout: "x\ny\n" });
});
