import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";

/**
 * The agent's shell keeps scratch files where any program does: the system's
 * temp folder, as TMPDIR, TMP and TEMP name it, and just-bash's own `mktemp`
 * writes there.
 */
const sessionId = StoreId.newSessionId();

let root: string;
let systemTemp: string;
let chatId: ChatId;
/**
 * The variables the system's temp folder is read from: TMPDIR on macOS and
 * Linux, TEMP or TMP on Windows.
 */
const TEMP_VARIABLES = ["TMPDIR", "TEMP", "TMP"] as const;
const savedTemp = new Map<string, string | undefined>();

async function run(command: string, { chat = false } = {}) {
  const bash = await createBashEnv({
    role: chat ? "chat" : "task",
    sessionId,
    chatId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-mktemp-")),
  );
  const chatRoot = path.join(root, "tasks", "test");
  systemTemp = path.join(root, "system-temp");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.mkdir(systemTemp);
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  // Stands for the system's temp folder, which the tests otherwise leave
  // unmounted.
  for (const name of TEMP_VARIABLES) {
    savedTemp.set(name, process.env[name]);
    process.env[name] = systemTemp;
  }
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    tempFolders: [AbsolutePathSchema.parse(systemTemp)],
  });
});

afterAll(async () => {
  for (const [name, value] of savedTemp) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await fs.rm(root, { force: true, recursive: true });
});

describe("temp files in the agent's shells", () => {
  it.each([false, true])(
    "mktemp names a file in the system's temp folder (chat: %s)",
    async (chat) => {
      const result = await run('f=$(mktemp) && test -f "$f" && echo "$f"', {
        chat,
      });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const made = result.stdout.trim();
      expect(path.posix.dirname(made)).toBe(shellPath(systemTemp));
      expect(path.posix.basename(made)).toMatch(/^tmp\.\w{10}$/);
    },
  );

  it("sets TMPDIR, TMP and TEMP to the system's temp folder", async () => {
    const result = await run(
      'echo hi > "$TMPDIR/x" && cat "$TMPDIR/x" && echo "$TMPDIR $TMP $TEMP"',
    );
    const shown = shellPath(systemTemp);
    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `hi\n${shown} ${shown} ${shown}\n`,
    });
  });
});
