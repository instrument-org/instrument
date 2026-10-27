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
 * Guards the just-bash patch that reads `bash` and `sh` options as bash does.
 * Unpatched, only `-c` as the first argument worked: `bash -lc 'echo hi'`,
 * the shape models trained on other harnesses reach for first, failed with
 * `bash: -lc: No such file or directory` at exit 127.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
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
    await fs.mkdtemp(path.join(os.tmpdir(), "shell-options-")),
  );
  const chatRoot = path.join(tmpDir, "chats", "test");
  await fs.mkdir(chatRoot, { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

it.each([
  "bash -lc 'echo hi'",
  "bash -l -c 'echo hi'",
  "bash -c -l 'echo hi'",
  "bash --login -c 'echo hi'",
  "bash -i -c 'echo hi'",
  "sh -lc 'echo hi'",
])("runs %s", async (command) => {
  expect(await run(command)).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "hi\n",
  });
});

it.each([
  ["bash -ec 'false; echo after'", { exitCode: 1, stderr: "", stdout: "" }],
  [
    "bash -euo pipefail -c 'false | true; echo after'",
    { exitCode: 1, stderr: "", stdout: "" },
  ],
  [
    "bash -xc 'echo hi'",
    { exitCode: 0, stderr: "+ echo hi\n", stdout: "hi\n" },
  ],
  [
    "printf 'false\\necho after\\n' > run.sh; bash -e run.sh",
    { exitCode: 1, stderr: "", stdout: "" },
  ],
])("applies the options of %s", async (command, result) => {
  expect(await run(command)).toEqual(result);
});
