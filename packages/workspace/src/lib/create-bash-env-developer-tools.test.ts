import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { MISSING_DEVELOPER_DIR } from "./command-line-tools-env";
import { createBashEnv } from "./create-bash-env";

/**
 * On a Mac without Apple's Command Line Tools, the shell refuses a developer
 * tool stub rather than running it, and explains a stub a program reached.
 * The stub here is a script carrying the marker a real stub's binary does,
 * and the recheck that asks the disk again is held to an answer.
 */
const stillMissing = vi.hoisted(() => ({ value: true }));
vi.mock("./command-line-tools-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./command-line-tools-env")>()),
  recheckCommandLineTools: () => Promise.resolve(stillMissing.value),
}));

const sessionId = StoreId.newSessionId();

let tmpDir: string;
let binDir: string;
let chatId: ChatId;
const original = {
  DEVELOPER_DIR: process.env.DEVELOPER_DIR,
  PATH: process.env.PATH,
};

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-developer-tools-")),
  );
  const chatRoot = path.join(tmpDir, "chats", "test");
  binDir = path.join(tmpDir, "bin");
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.mkdir(binDir);
  await fs.writeFile(
    path.join(binDir, "fakecc"),
    "#!/bin/sh\n# _xcselect_invoke_xcrun\necho compiled\n",
    { mode: 0o755 },
  );
  // A program that runs a stub the guard stops, as a build script would.
  await fs.writeFile(
    path.join(binDir, "builds"),
    '#!/bin/sh\necho "xcrun: error: missing DEVELOPER_DIR path: $DEVELOPER_DIR" >&2\nexit 1\n',
    { mode: 0o755 },
  );
  process.env.PATH = `${binDir}${path.delimiter}${original.PATH ?? ""}`;
  process.env.DEVELOPER_DIR = MISSING_DEVELOPER_DIR;
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  process.env.PATH = original.PATH;
  if (original.DEVELOPER_DIR === undefined) {
    delete process.env.DEVELOPER_DIR;
  } else {
    process.env.DEVELOPER_DIR = original.DEVELOPER_DIR;
  }
  await fs.rm(tmpDir, { force: true, recursive: true });
});

const refusal =
  "fakecc needs Apple's Command Line Tools, which aren't installed on this Mac. Ask the person whether they want to install them (they run `xcode-select --install` in Terminal), and run the command again once they have.\n";

describe.runIf(process.platform === "darwin")(
  "developer tool stubs without the tools",
  () => {
    it.each([["fakecc"], ["$STUBS/fakecc"], ["env fakecc --version"]])(
      "refuses %s without running it",
      async (command) => {
        stillMissing.value = true;
        const result = await run(`STUBS=${binDir}; ${command}; echo "exit $?"`);
        expect(result).toMatchObject({ stderr: refusal, stdout: "exit 127\n" });
      },
    );

    it("tells which it is not there", async () => {
      stillMissing.value = true;
      const result = await run("which fakecc; echo $?");
      expect(result).toMatchObject({
        stderr: `which: ${refusal}`,
        stdout: "1\n",
      });
    });

    it("runs it once the tools are installed", async () => {
      stillMissing.value = false;
      const result = await run("fakecc");
      expect(result).toMatchObject({ exitCode: 0, stdout: "compiled\n" });
    });

    it("says to run it again when the tools arrived since the guard was set", async () => {
      stillMissing.value = false;
      const result = await run("builds");
      expect(result.stderr).toContain(
        "Apple's Command Line Tools are installed now, so run the command again.\n",
      );
    });

    it("explains a stub a program reached", async () => {
      stillMissing.value = true;
      const result = await run("builds");
      expect(result.stderr).toMatchInlineSnapshot(`
        "xcrun: error: missing DEVELOPER_DIR path: /nonexistent/instrument-command-line-tools-not-installed
        A program this command started needs Apple's Command Line Tools, which aren't installed on this Mac. Ask the person whether they want to install them (they run \`xcode-select --install\` in Terminal), and run the command again once they have.
        "
      `);
    });
  },
);
