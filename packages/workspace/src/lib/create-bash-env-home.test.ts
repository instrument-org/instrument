import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

/**
 * `~` in the shell is the home the rules hold, so a path the agent spells
 * from it reaches that home and asks for its places, rather than resolving
 * against `/`.
 */
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let home: string;
let chatId: ChatId;
let originalHome: string | undefined;

async function run(command: string) {
  const bash = await createBashEnv({ sessionId, chatId });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-home-")),
  );
  home = path.join(tmpDir, "home");
  await fs.mkdir(path.join(home, "Documents"), { recursive: true });
  await fs.writeFile(path.join(home, "Documents", "taxes.txt"), "1040");
  const chatRoot = path.join(tmpDir, "chats", "test");
  await fs.mkdir(chatRoot, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = home;
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  // The system's own temp folders, which hold this test's planted home.
  const { tempFolders: _tests, ...system } = getWorkspaceConfig();
  setWorkspaceConfig(system);
});

afterAll(async () => {
  process.env.HOME = originalHome;
  await fs.rm(tmpDir, { force: true, recursive: true });
});

it("expands ~ to the home the rules hold", async () => {
  const result = await run('echo ~ "$HOME"');
  expect(result.stdout).toBe(`${home} ${home}\n`);
});

it("asks for Documents when the agent lists ~/Documents", async () => {
  const result = await run("ls ~/Documents");
  const said = `${result.stdout}${result.stderr}`;
  expect(result.exitCode).not.toBe(0);
  expect(said).toContain(`${home}/Documents`);
  expect(said).not.toContain("taxes.txt");
  expect(said).not.toContain("//Documents");
});

it.skipIf(process.platform === "win32")(
  "writes /tmp and the process's temp folder without asking",
  async () => {
    const name = `bash-home-scratch-${process.pid}`;
    const own = path.join(await fs.realpath(os.tmpdir()), name);
    const result = await run(
      `echo x > /tmp/${name} && cat /tmp/${name} && rm /tmp/${name} && echo y > ${own}.own && cat ${own}.own && rm ${own}.own`,
    );
    await fs.rm(`/tmp/${name}`, { force: true });
    await fs.rm(`${own}.own`, { force: true });
    expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "x\ny\n" });
  },
);

it("asks before changing the home folder a temp folder holds", async () => {
  const result = await run("touch ~/notes.txt");
  expect(result.exitCode).not.toBe(0);
  await expect(fs.stat(path.join(home, "notes.txt"))).rejects.toThrow();
});

it.skipIf(process.platform === "win32")(
  "keeps the workspace a temp folder holds closed",
  async () => {
    const result = await run(
      "ls /tmp/workspace; touch /tmp/workspace/leak.txt",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Permission denied");
    expect(result.stderr).toContain("Instrument's own data");
    await expect(fs.stat("/tmp/workspace/leak.txt")).rejects.toThrow();
  },
);
