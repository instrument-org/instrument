import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import {
  createMockChatConfigForDir,
  MOCK_WORKSPACE_DIRS,
} from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { hostPathOf, shellPath } from "./workspace-fs-layout";

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
  // Where Windows reads the home folder from.
  vi.stubEnv("USERPROFILE", home);
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  // The system's own temp folders, which hold this test's planted home. Held
  // by MXC, a program starts through uutils, as in the app, which gives it
  // back the temp folder Windows takes from it.
  const { tempFolders: _tests, ...system } = getWorkspaceConfig();
  setWorkspaceConfig({
    ...system,
    ...(system.mxcExecPath && {
      uutilsDir: AbsolutePathSchema.parse(
        path.resolve(
          import.meta.dirname,
          "../../../../apps/studio/resources/uutils",
        ),
      ),
    }),
  });
});

afterAll(async () => {
  process.env.HOME = originalHome;
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { force: true, recursive: true });
});

it("expands ~ to the home the rules hold", async () => {
  const result = await run('echo ~ "$HOME"');
  expect(result.stdout).toBe(`${shellPath(home)} ${shellPath(home)}\n`);
});

it("asks for Documents when the agent lists ~/Documents", async () => {
  const result = await run("ls ~/Documents");
  const said = `${result.stdout}${result.stderr}`;
  expect(result.exitCode).not.toBe(0);
  expect(said).toContain(`${shellPath(home)}/Documents`);
  expect(said).not.toContain("taxes.txt");
  expect(said).not.toContain("//Documents");
});

it("writes /tmp and the process's temp folder without asking", async () => {
  const name = `bash-home-scratch-${process.pid}`;
  const own = shellPath(path.join(await fs.realpath(os.tmpdir()), name));
  const result = await run(
    `echo x > /tmp/${name} && cat /tmp/${name} && rm /tmp/${name} && echo y > ${own}.own && cat ${own}.own && rm ${own}.own`,
  );
  await fs.rm(`/tmp/${name}`, { force: true });
  await fs.rm(hostPathOf(`${own}.own`), { force: true });
  expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "x\ny\n" });
});

/** A node one-liner that runs `body` with `file` the named file in its temp folder. */
function inProgramTemp(name: string, body: string): string {
  return `node -e "const file = require('path').join(require('os').tmpdir(), '${name}'); ${body}"`;
}

it(
  "names by /tmp on Windows, and by $TMPDIR anywhere, the file a program finds in its temp folder",
  { timeout: 30_000 },
  async () => {
    const name = `bash-home-shared-${process.pid}`;
    const shellTemp = process.platform === "win32" ? "/tmp" : '"$TMPDIR"';
    try {
      const written = await run(`echo from-shell > ${shellTemp}/${name}`);
      expect(written.exitCode).toBe(0);
      // A program the shell starts, held by the native sandbox where one
      // runs, finds it through the temp folder its language gives it.
      const read = await run(
        inProgramTemp(
          name,
          "process.stdout.write(require('fs').readFileSync(file, 'utf8'))",
        ),
      );
      expect(read).toMatchObject({ exitCode: 0, stdout: "from-shell\n" });
      await expect(
        fs.readFile(path.join(os.tmpdir(), name), "utf8"),
      ).resolves.toBe("from-shell\n");
      const wrote = await run(
        inProgramTemp(
          name,
          "require('fs').writeFileSync(file, 'from-program')",
        ),
      );
      expect(wrote).toMatchObject({ exitCode: 0, stderr: "" });
      expect((await run(`cat ${shellTemp}/${name}`)).stdout).toBe(
        "from-program",
      );
    } finally {
      await fs.rm(path.join(os.tmpdir(), name), { force: true });
    }
  },
);

it("asks before changing the home folder a temp folder holds", async () => {
  const result = await run("touch ~/notes.txt");
  expect(result.exitCode).not.toBe(0);
  await expect(fs.stat(path.join(home, "notes.txt"))).rejects.toThrow();
});

it.skipIf(process.platform === "win32")(
  "keeps the workspace's records a temp folder holds closed",
  async () => {
    const records = path.join(MOCK_WORKSPACE_DIRS.root, ".instrument");
    await fs.mkdir(records, { recursive: true });
    const result = await run(`ls '${records}'; touch '${records}/leak.txt'`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Permission denied");
    expect(result.stderr).toContain("Instrument's own data");
    await expect(fs.stat(path.join(records, "leak.txt"))).rejects.toThrow();
  },
);
