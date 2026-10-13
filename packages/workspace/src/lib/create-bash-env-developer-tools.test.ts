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
 * On a Mac without Apple's Command Line Tools, a developer tool stub the
 * sandbox kept from asking for an install fails with its own error, and the
 * shell says what to do about it. The stub here is a script printing what a
 * real one does.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let chatId: ChatId;
const originalPath = process.env.PATH;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-developer-tools-")),
  );
  const chatRoot = path.join(tmpDir, "chats", "test");
  const binDir = path.join(tmpDir, "bin");
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.mkdir(binDir);
  // A program that runs a stub, as a build script would.
  await fs.writeFile(
    path.join(binDir, "builds"),
    '#!/bin/sh\necho "xcode-select: error: No developer tools were found and no install could be requested (possibly because there is no active GUI session)." >&2\nexit 1\n',
    { mode: 0o755 },
  );
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  process.env.PATH = originalPath;
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.runIf(process.platform === "darwin")(
  "developer tool stubs without the tools",
  () => {
    it("explains a stub a program reached", async () => {
      const result = await run("builds");
      expect(result).toMatchObject({ exitCode: 1 });
      expect(result.stderr).toMatchInlineSnapshot(`
        "xcode-select: error: No developer tools were found and no install could be requested (possibly because there is no active GUI session).
        This command, or a program it started, needs Apple's Command Line Tools, which aren't installed on this Mac. Ask the person whether they want to install them (they run \`xcode-select --install\` in Terminal), and run the command again once they have.
        "
      `);
    });
  },
);
