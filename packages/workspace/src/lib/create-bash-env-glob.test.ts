import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";

/**
 * Guards the just-bash patch for a glob after a quoted directory. Unpatched,
 * `"$INSTRUMENT_WORK"/*` read the directory with its quoted characters still
 * backslash-escaped, so it matched nothing, and the word then split at every
 * space: on macOS every work folder is under Application Support, so it
 * failed in every chat, and the escaped path reached the rules as a folder to
 * ask for. The work folder here has a space, parentheses and brackets in its
 * path, and each command prints what bash prints in the same folder.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let chatRoot: string;
let chatId: ChatId;

async function sandboxed(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  const result = await bash.exec(command, {
    signal: AbortSignal.timeout(30_000),
  });
  return { exitCode: result.exitCode, stdout: result.stdout };
}

function realBash(command: string) {
  return execFileSync("bash", ["-c", command], {
    cwd: chatRoot,
    encoding: "utf8",
    env: { ...process.env, INSTRUMENT_WORK: chatRoot, PWD: chatRoot },
  });
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "App Support (x) [y] ")),
  );
  chatRoot = path.join(tmpDir, "chats", "test");
  await fs.mkdir(path.join(chatRoot, "sub (1) [a]"), { recursive: true });
  await fs.writeFile(path.join(chatRoot, "a.txt"), "a");
  await fs.writeFile(path.join(chatRoot, "b.txt"), "b");
  await fs.writeFile(path.join(chatRoot, "sub (1) [a]", "c.md"), "c");
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.runIf(process.platform !== "win32")(
  "a glob after a quoted folder",
  () => {
    it("sees the work folder at the path bash is given", async () => {
      expect((await sandboxed(`printf %s "$INSTRUMENT_WORK"`)).stdout).toBe(
        chatRoot,
      );
    });

    it.each([
      `printf '[%s]\\n' "$INSTRUMENT_WORK"/*`,
      `for f in "$INSTRUMENT_WORK"/*.txt; do echo "[$f]"; done`,
      `ls -d "$INSTRUMENT_WORK/sub (1) [a]"/*.md`,
      `printf '[%s]\\n' "$PWD"/sub*/*`,
      `printf '[%s]\\n' "$INSTRUMENT_WORK"/*.csv`,
    ])("%s prints what bash prints", async (command) => {
      const result = await sandboxed(command);
      expect(result).toEqual({ exitCode: 0, stdout: realBash(command) });
      expect(result.stdout).toContain(chatRoot);
    });
  },
);
