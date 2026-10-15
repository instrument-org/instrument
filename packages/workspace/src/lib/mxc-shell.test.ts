import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CHAT_FOLDER_NAMES } from "../constants";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

// The uutils Studio's postinstall vendors, so the text commands are programs.
const UUTILS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../apps/studio/resources/uutils",
);

/**
 * A chat's shell with MXC holding its native commands, on Windows only:
 * INSTRUMENT_TEST_MXC_EXEC names the launcher and INSTRUMENT_MXC=1 turns it
 * on. A file under `AppData` (outside its temp folder, which the rules open)
 * sits in a place that asks first, so a program reading it is refused by
 * the container, and each pipeline stage is told so on its own. Run it in
 * the interactive session, as the canary's test.
 */
const held =
  process.platform === "win32" &&
  process.env.INSTRUMENT_TEST_MXC_EXEC !== undefined &&
  process.env.INSTRUMENT_MXC === "1";

const sessionId = StoreId.newSessionId();
let tmpDir: string;
let closedFile: string;
let chatId: ChatId;
const secret = randomUUID();

async function run(command: string) {
  const bash = await createBashEnv({ chatId, sessionId });
  return bash.exec(command, { signal: AbortSignal.timeout(60_000) });
}

/**
 * A node one-liner that prints the closed file. The path is inside the
 * script, where no check of the shell's reads it, so only the container can
 * refuse it.
 */
function readsClosed(): string {
  const encoded = Buffer.from(closedFile).toString("base64");
  return `node -e "process.stdout.write(require('fs').readFileSync(Buffer.from('${encoded}', 'base64').toString(), 'utf8'))"`;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mxc-shell-"));
  const chatRoot = path.join(tmpDir, "chats", "mxc");
  await fs.mkdir(path.join(chatRoot, CHAT_FOLDER_NAMES.private), {
    recursive: true,
  });
  await fs.writeFile(path.join(chatRoot, "words.txt"), "b\na\nc\n");
  // Under `AppData` but outside its temp folder, which the rules open.
  closedFile = path.join(
    process.env.LOCALAPPDATA ?? tmpDir,
    `mxc-shell-${randomUUID()}`,
    "secret.txt",
  );
  await fs.mkdir(path.dirname(closedFile), { recursive: true });
  await fs.writeFile(closedFile, secret);
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    uutilsDir: AbsolutePathSchema.parse(UUTILS_DIR),
  });
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
  await fs.rm(path.dirname(closedFile), { force: true, recursive: true });
});

describe.runIf(held)("a chat's shell under MXC", () => {
  it("runs a program in the chat's folder", async () => {
    const result = await run(
      "node -e \"require('fs').writeFileSync('made.txt', 'ok'); console.log(require('fs').realpathSync.native('made.txt'))\"",
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    // Resolved to its drive-letter path, which the shell spells its own way.
    expect(result.stdout).toMatch(/^\/[a-z]\/.*\/made\.txt\n$/i);
    expect(
      await fs.readFile(path.join(tmpDir, "chats", "mxc", "made.txt"), "utf8"),
    ).toBe("ok");
  });

  it("refuses a program reading a folder that asks first, and says why", async () => {
    const result = await run(readsClosed());
    expect(result.stdout).not.toContain(secret);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("EPERM");
    expect(result.stderr).toMatch(/asks first|ask|allow/i);
  });

  it("refuses each pipeline stage on its own", async () => {
    const result = await run(
      `set -o pipefail; sort words.txt | ${readsClosed()} | sort; echo "status \${PIPESTATUS[@]}"`,
    );
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).toMatch(/status 0 1 0/);
    expect(result.stderr).toContain("EPERM");
  });

  it("streams between stages it holds", async () => {
    const result = await run("sort words.txt | uniq | head -2");
    expect(result.stdout).toBe("a\nb\n");
  });
});
