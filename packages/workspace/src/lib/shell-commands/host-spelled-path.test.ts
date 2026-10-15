import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MountedFolder } from "../../schemas/mounted-folder";
import { ChatDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { createBashEnv } from "../create-bash-env";
import { shellPath } from "../workspace-fs-layout";
import { type ChatId } from "../../schemas/chat-id";

/**
 * Every command that hands a path to a program on the disk, each naming a
 * path the way this computer names one. A program opens such a path whatever
 * the shell makes of it, so every one of these is held to the rules the
 * shell's own spelling of the same path is held to; a new command of this
 * kind belongs here.
 *
 * Only Windows spells a path a second way, so this is where it runs. On macOS
 * and Linux the shell's spelling is the computer's, and
 * `shellPathOfHostSpelling` (tested in `workspace-fs-layout.test.ts`) is what
 * answers for the resolution these commands share.
 */
const BRIDGING_COMMANDS = [
  { command: (named: string) => `rg NEEDLE '${named}'`, name: "rg" },
  {
    command: (named: string) => `rg --file='${named}' .`,
    name: "rg, in a flag's value",
  },
  { command: (named: string) => `du -sh '${named}'`, name: "du" },
  { command: (named: string) => `git init '${named}'`, name: "git" },
] as const;

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let chatRoot: string;
let outsideDir: string;
let attachedDir: string;
let chatId: ChatId;

async function run(command: string, attach = false) {
  const bash = await createBashEnv({
    folders: attach
      ? {
          Docs: {
            access: "read-only",
            id: MountedFolder.IdSchema.parse("docs-id"),
            path: ChatDirSchema.parse(attachedDir),
          },
        }
      : undefined,
    sessionId,
    chatId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeEach(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "host-spelled-")),
  );
  chatRoot = path.join(tmpDir, "chats", "test");
  outsideDir = path.join(tmpDir, "outside");
  attachedDir = path.join(tmpDir, "Docs");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
  await fs.mkdir(attachedDir, { recursive: true });
  await fs.writeFile(path.join(outsideDir, "secret.txt"), "NEEDLE outside\n");
  await fs.writeFile(path.join(attachedDir, "note.md"), "NEEDLE attached\n");
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot), { model });
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe.runIf(process.platform === "win32")(
  "a path spelled the way this computer spells it",
  () => {
    it.each(BRIDGING_COMMANDS)(
      "$name refuses one outside every folder the chat reaches",
      async ({ command }) => {
        const named = path.join(outsideDir, "secret.txt");

        const result = await run(command(named));

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(shellPath(named));
        expect(result.stdout).not.toContain("NEEDLE");
      },
    );

    it("writes nothing where git was refused", async () => {
      const named = path.join(outsideDir, "repo");

      const result = await run(`git init '${named}'`);

      expect(result.exitCode).not.toBe(0);
      await expect(fs.stat(named)).rejects.toThrow();
    });

    it.each([
      { command: (named: string) => `rg NEEDLE '${named}'`, name: "rg" },
      { command: (named: string) => `du -sh '${named}'`, name: "du" },
    ])(
      "$name reads one inside a folder the chat reaches",
      async ({ command }) => {
        const named = path.join(attachedDir, "note.md");

        const result = await run(command(named), true);

        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
      },
    );
  },
);
