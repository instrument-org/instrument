import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bwrapAvailable, seatbeltAvailable } from "../native-sandbox";
import { MountedFolder } from "../../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { createMockAIGatewayModel } from "../../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { createBashEnv } from "../create-bash-env";
import { updatePermissionSettings } from "../permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";

/**
 * Every command that hands a path to a program on the disk, each naming a
 * file the rules close. A program opens the path it is given whatever the
 * shell makes of that spelling, so a command of this kind resolves its
 * argument before asking the rules, and the two spellings of one file meet
 * the same answer. A new command of this kind belongs here.
 *
 * On Windows the test names the closed file the way the computer names it
 * (`C:\Users\sam\Docs\locked\secret.txt`), which is the spelling the shell
 * makes nothing of; on macOS and Linux there is only the one spelling, and
 * these are plain refusal cases.
 */
const BRIDGING_COMMANDS = [
  {
    command: (named: string) => `rg NEEDLE '${named}'`,
    name: "rg",
    under: "secret.txt",
  },
  {
    command: (named: string) => `rg --file='${named}' .`,
    name: "rg, in a flag's value",
    // A flag's value is taken for a path only where it is spelled the way
    // this computer spells one and the shell spells one differently, since
    // `-e /etc/passwd` is a pattern rather than a file. Where the two
    // spellings are the same, as on macOS and Linux, the shim hands the
    // value to the binary and the sandbox is what refuses the read, so
    // there has to be one for this case to refuse anything.
    needsSandbox: true,
    under: "secret.txt",
  },
  {
    command: (named: string) => `du -sh '${named}'`,
    name: "du",
    under: "secret.txt",
  },
  {
    command: (named: string) => `git init '${named}'`,
    name: "git",
    under: "repo",
  },
] as const;

/**
 * Whether this computer holds a program the agent starts inside a sandbox.
 * A Linux machine without user namespaces has none, which is the shape of a
 * CI runner.
 */
const sandboxHere = () =>
  process.platform === "win32" || seatbeltAvailable() || bwrapAvailable();

const model = createMockAIGatewayModel();
const sessionId = StoreId.newSessionId();

let tmpDir: string;
let docs: string;
let closed: string;
let chatId: ChatId;

async function run(command: string) {
  const bash = await createBashEnv({
    folders: {
      Docs: {
        access: "read-write",
        id: MountedFolder.IdSchema.parse("docs-id"),
        path: ChatDirSchema.parse(docs),
      },
    },
    sessionId,
    chatId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeEach(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "host-spelled-")),
  );
  const chatRoot = path.join(tmpDir, "chats", "test");
  docs = path.join(tmpDir, "Docs");
  closed = path.join(docs, "locked");
  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.mkdir(closed, { recursive: true });
  await fs.writeFile(path.join(closed, "secret.txt"), "NEEDLE closed\n");
  await fs.writeFile(path.join(docs, "note.md"), "NEEDLE in Docs\n");
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot), { model });
  // The rules live in the workspace's machine folder, which the mock chats
  // share across test files, so this file keeps a workspace of its own.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(tmpDir, "workspace")),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(tmpDir, "machine")),
  });
  await updatePermissionSettings((settings) => ({
    ...settings,
    folders: [
      {
        addedAt: new Date(),
        level: "never",
        path: AbsolutePathSchema.parse(closed),
      },
    ],
  }));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("a path spelled the way this computer spells it", () => {
  it.each(
    BRIDGING_COMMANDS.filter(
      (bridging) => !("needsSandbox" in bridging) || sandboxHere(),
    ),
  )("$name refuses one the rules close", async ({ command, under }) => {
    const result = await run(command(path.join(closed, under)));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toBe("");
    expect(result.stdout).not.toContain("NEEDLE");
  });

  it("writes nothing where git was refused", async () => {
    const named = path.join(closed, "repo");

    const result = await run(`git init '${named}'`);

    expect(result.exitCode).not.toBe(0);
    await expect(fs.stat(named)).rejects.toThrow();
  });

  it.each([
    { command: (named: string) => `rg NEEDLE '${named}'`, name: "rg" },
    { command: (named: string) => `du -sh '${named}'`, name: "du" },
  ])("$name reads one the rules open", async ({ command }) => {
    const result = await run(command(path.join(docs, "note.md")));

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  // Windows resolves a path that names its drive without a separator after
  // the colon against the folder the program runs in on that drive, so
  // `C:..\..\Docs\locked` reaches out of the work folder while the shell
  // reads it as a name inside it.
  describe.runIf(process.platform === "win32")(
    "naming the drive and hanging off the folder the program runs in",
    () => {
      /** The closed file as `C:` plus the hops a program in the shell's folder takes to it. */
      const driveRelative = (under: string) =>
        `C:${path.relative(
          path.join(tmpDir, "chats", "test"),
          path.join(closed, under),
        )}`;

      // Each asks for the refusal itself, not just a non-zero exit: a
      // spelling the bridge misses reaches the real program, which then fails
      // for its own reasons and reads as a refusal that never happened.
      it.each(BRIDGING_COMMANDS)("$name refuses one", async (bridging) => {
        const result = await run(
          bridging.command(driveRelative(bridging.under)),
        );

        expect(result.stderr).toContain("closed in Settings");
        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain("NEEDLE");
      });

      it("refuses one a short flag carries attached to it", async () => {
        const result = await run(`rg '-f${driveRelative("secret.txt")}' .`);

        expect(result.stderr).toContain("closed in Settings");
        expect(result.exitCode).not.toBe(0);
      });

      it("leaves a search for a word that starts like a drive alone", async () => {
        const result = await run(`rg 'c:needle' '${docs}'`);

        // Nothing matches it, and nothing refuses it either: it is a pattern.
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe("");
      });
    },
  );
});
