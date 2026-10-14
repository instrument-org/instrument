import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";

/**
 * `du` walks the real directories behind the mounts in a worker thread rather
 * than the virtual filesystem on the main thread (`shell-commands/du.ts`).
 * Byte counts are asserted with `-b` and `--apparent-size`, since disk usage in
 * blocks depends on the filesystem the test runs on.
 */
const sessionId = StoreId.newSessionId();

/** More entries than the chat's 20,000-entry traversal budget. */
const WIDE_FILES = 21_000;

let tmpDir: string;
let chatRoot: string;
let homeDir: string;
let wideDir: string;
let chatId: ChatId;

async function run(command: string, { chat = false } = {}) {
  const attach = (name: string, folder: string) => ({
    access: "read-only" as const,
    createdAt: Date.now(),
    id: MountedFolder.IdSchema.parse(`${name}-id`),
    mountName: name,
    path: ChatDirSchema.parse(folder),
    source: "user" as const,
  });
  const bash = await createBashEnv({
    folders: {
      // Deleted on disk since it was attached, so the sandbox leaves it out.
      Gone: attach("Gone", path.join(tmpDir, "Gone")),
      Home: attach("Home", homeDir),
      Wide: attach("Wide", wideDir),
    },
    role: chat ? "chat" : "task",
    sessionId,
    chatId,
  });
  return bash.exec(command, { signal: AbortSignal.timeout(30_000) });
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-du-"));
  chatRoot = path.join(tmpDir, "tasks", "test");
  homeDir = path.join(tmpDir, "Home");
  wideDir = path.join(tmpDir, "Wide");

  await fs.mkdir(path.join(homeDir, "notes", "deep"), { recursive: true });
  await fs.mkdir(path.join(homeDir, "photos"), { recursive: true });
  await fs.writeFile(path.join(homeDir, "notes", "one.txt"), "x".repeat(1500));
  await fs.writeFile(
    path.join(homeDir, "notes", "deep", "two.txt"),
    "y".repeat(3000),
  );
  await fs.writeFile(
    path.join(homeDir, "photos", "big.bin"),
    "z".repeat(50_000),
  );

  await fs.mkdir(path.join(chatRoot, "work"), { recursive: true });
  await fs.writeFile(path.join(chatRoot, "work", "small.txt"), "s".repeat(10));

  await fs.mkdir(wideDir, { recursive: true });
  await Promise.all(
    Array.from({ length: WIDE_FILES }, (_, i) =>
      fs.writeFile(path.join(wideDir, `f${i}`), ""),
    ),
  );

  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("du", () => {
  it("prints a file's size in bytes and in GNU's rounded-up human form", async () => {
    const file = `${homeDir}/notes/one.txt`;
    const bytes = await run(`du -b '${file}'`);
    const human = await run(`du --apparent-size -h '${file}'`);

    expect(bytes.stdout).toBe(`1500\t${file}\n`);
    expect(human.stdout).toBe(`1.5K\t${file}\n`);
  });

  it("lists children before their parent, down to the depth asked", async () => {
    const result = await run(`du -b -d 1 '${homeDir}'`);
    const lines = result.stdout.trim().split("\n");
    const paths = lines.map((line) => line.split("\t")[1]);
    const size = (target: string) =>
      Number(
        lines.find((line) => line.endsWith(`\t${target}`))?.split("\t")[0],
      );

    expect(result.exitCode).toBe(0);
    expect(paths).toEqual([`${homeDir}/notes`, `${homeDir}/photos`, homeDir]);
    expect(size(`${homeDir}/notes`)).toBeGreaterThanOrEqual(4500);
    expect(size(homeDir)).toBeGreaterThanOrEqual(
      size(`${homeDir}/notes`) + size(`${homeDir}/photos`),
    );
  });

  it("prints paths as they were typed, relative ones included", async () => {
    const result = await run(`cd '${homeDir}' && du -ab notes`);

    expect(result.stdout.trim().split("\n").at(-1)).toMatch(/^\d+\tnotes$/);
    expect(result.stdout).toContain("\tnotes/deep/two.txt\n");
    expect(result.stdout).not.toContain(tmpDir);
  });

  it("adds a grand total with -c", async () => {
    const result = await run(
      `du -cb '${homeDir}/notes/one.txt' '${homeDir}/notes/deep/two.txt'`,
    );

    expect(result.stdout.trim().split("\n").at(-1)).toBe("4500\ttotal");
  });

  it("lists and counts the work folder whole, hidden entries included", async () => {
    await fs.writeFile(path.join(chatRoot, ".hidden"), "h".repeat(20));
    const listing = await run(`du -ab '${chatRoot}'`);
    const total = await run(`du -sb '${chatRoot}'`);

    expect(listing.stdout).toContain(`\t${chatRoot}/work/small.txt\n`);
    expect(listing.stdout).toContain(`\t${chatRoot}/.hidden\n`);
    expect(Number(total.stdout.split("\t")[0])).toBe(30);
  });

  it("answers past the chat's traversal budget", async () => {
    // The walk is not the virtual filesystem's, so the budget that stops
    // find and ls over this folder does not apply to it.
    const result = await run(`du -a '${wideDir}' | wc -l`, { chat: true });

    expect(result.exitCode).toBe(0);
    expect(Number(result.stdout.trim())).toBe(WIDE_FILES + 1);
  });

  it("ranks du -h sizes by size in sort -rh, not by their digits", async () => {
    // Guards the sort part of the local just-bash patch
    // (vercel-labs/just-bash#452): without it the suffix after a leading size
    // is dropped, so 49K outranks 2.0M.
    const result = await run(
      `printf '49K\\tsmall\\n2.0M\\tlarge\\n' | sort -rh`,
    );

    expect(result.stdout).toBe("2.0M\tlarge\n49K\tsmall\n");
  });

  it.skipIf(process.platform === "win32")(
    "measures a folder outside every mount on the disk",
    async () => {
      const outside = path.join(tmpDir, "Outside");
      await fs.mkdir(path.join(outside, "sub"), { recursive: true });
      await fs.writeFile(path.join(outside, "sub", "a.txt"), "a".repeat(700));
      const result = await run(`du -sb '${outside}'`);
      expect(result.stdout).toMatch(new RegExp(`^\\d+\t${outside}\n$`));
      expect(Number(result.stdout.split("\t")[0])).toBeGreaterThanOrEqual(700);
    },
  );

  it("leaves a flag it does not implement to just-bash", async () => {
    const result = await run(`du --time '${homeDir}'`);

    expect(result.stderr).toContain("--time");
  });
});
