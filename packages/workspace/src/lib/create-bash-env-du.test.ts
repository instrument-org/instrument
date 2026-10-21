import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import { ChatDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { createBashEnv } from "./create-bash-env";
import { updatePermissionSettings } from "./permissions/rules";
import { getWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";

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
  // In batches: Windows runs out of file handles opening them all at once.
  for (let start = 0; start < WIDE_FILES; start += 1000) {
    await Promise.all(
      Array.from({ length: Math.min(1000, WIDE_FILES - start) }, (_, i) =>
        fs.writeFile(path.join(wideDir, `f${start + i}`), ""),
      ),
    );
  }

  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  // Windows takes most of a minute to write the wide folder.
}, 120_000);

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("du", () => {
  // The folders as the shell spells them.
  const home = () => shellPath(homeDir);

  it.runIf(process.platform === "darwin")(
    "steps over a folder macOS guards on the way down, and walks one named",
    async () => {
      // The attached home stands in for the person's, whose Documents macOS
      // would ask about before the app reads inside it.
      const homedir = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
      // The person allowed Documents, which says nothing of macOS's answer.
      const before = await updatePermissionSettings((settings) => settings);
      await updatePermissionSettings((settings) => ({
        ...settings,
        places: { ...settings.places, documents: "allow" },
      }));
      await fs.mkdir(path.join(homeDir, "Documents"), { recursive: true });
      await fs.writeFile(
        path.join(homeDir, "Documents", "a.txt"),
        "d".repeat(700),
      );
      try {
        const over = await run(`du -b -d 1 '${home()}'`);
        const named = await run(`du -b '${home()}/Documents'`);

        expect(over.stdout).not.toContain(`${home()}/Documents`);
        expect(over.stderr).toContain(
          `du: left out '${home()}/Documents', which macOS asks the person about before the app reads inside`,
        );
        expect(Number(named.stdout.split("\t")[0])).toBeGreaterThanOrEqual(700);
      } finally {
        await updatePermissionSettings(() => before);
        homedir.mockRestore();
        await fs.rm(path.join(homeDir, "Documents"), {
          force: true,
          recursive: true,
        });
      }
    },
  );

  it("prints a file's size in bytes and in GNU's rounded-up human form", async () => {
    const file = `${home()}/notes/one.txt`;
    const bytes = await run(`du -b '${file}'`);
    const human = await run(`du --apparent-size -h '${file}'`);

    expect(bytes.stdout).toBe(`1500\t${file}\n`);
    expect(human.stdout).toBe(`1.5K\t${file}\n`);
  });

  it("lists children before their parent, down to the depth asked", async () => {
    const result = await run(`du -b -d 1 '${home()}'`);
    const lines = result.stdout.trim().split("\n");
    const paths = lines.map((line) => line.split("\t")[1]);
    const size = (target: string) =>
      Number(
        lines.find((line) => line.endsWith(`\t${target}`))?.split("\t")[0],
      );

    expect(result.exitCode).toBe(0);
    expect(paths).toEqual([`${home()}/notes`, `${home()}/photos`, home()]);
    expect(size(`${home()}/notes`)).toBeGreaterThanOrEqual(4500);
    expect(size(home())).toBeGreaterThanOrEqual(
      size(`${home()}/notes`) + size(`${home()}/photos`),
    );
  });

  it("prints paths as they were typed, relative ones included", async () => {
    const result = await run(`cd '${home()}' && du -ab notes`);

    expect(result.stdout.trim().split("\n").at(-1)).toMatch(/^\d+\tnotes$/);
    expect(result.stdout).toContain("\tnotes/deep/two.txt\n");
    expect(result.stdout).not.toContain(shellPath(tmpDir));
  });

  it("adds a grand total with -c", async () => {
    const result = await run(
      `du -cb '${home()}/notes/one.txt' '${home()}/notes/deep/two.txt'`,
    );

    expect(result.stdout.trim().split("\n").at(-1)).toBe("4500\ttotal");
  });

  it("lists and counts the work folder whole, hidden entries included", async () => {
    await fs.writeFile(path.join(chatRoot, ".hidden"), "h".repeat(20));
    const chat = shellPath(chatRoot);
    const listing = await run(`du -ab '${chat}'`);
    const total = await run(`du -sb '${chat}'`);

    expect(listing.stdout).toContain(`\t${chat}/work/small.txt\n`);
    expect(listing.stdout).toContain(`\t${chat}/.hidden\n`);
    expect(Number(total.stdout.split("\t")[0])).toBe(30);
  });

  it("answers past the chat's traversal budget", async () => {
    // The walk is not the virtual filesystem's, so the budget that stops
    // find and ls over this folder does not apply to it.
    const result = await run(`du -a '${shellPath(wideDir)}' | wc -l`, {
      chat: true,
    });

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

  it("refuses the app's own data as ls does, with the same note", async () => {
    const { userDataDir } = getWorkspaceConfig();
    await fs.mkdir(userDataDir, { recursive: true });
    const machine = shellPath(userDataDir);
    const du = await run(`du -s '${machine}'`);
    const ls = await run(`ls '${machine}'`);

    expect(du.exitCode).toBe(1);
    expect(du.stdout).toBe("");
    const [denied, note] = du.stderr.split("\n");
    expect(denied).toBe(`du: cannot access '${machine}': Permission denied`);
    expect(note).toMatch(/is Instrument's own data/);
    expect(ls.stderr).toContain(note);
  });

  it("leaves a flag it does not implement to just-bash", async () => {
    const result = await run(`du --time '${home()}'`);

    expect(result.stderr).toContain("--time");
  });
});
