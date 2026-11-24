import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RG_DISK_PATH } from "@instrument-org/workspace/electron";

import { listRepositoryFiles } from "./list-repository";
import { walkFileNames } from "./walk";

vi.mock("electron", () => ({ app: {} }));

describe.skipIf(!fsSync.existsSync(RG_DISK_PATH))(
  "listRepositoryFiles with the bundled ripgrep",
  () => {
    let root: string;
    beforeEach(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "list-repository-"));
      for (const file of [
        ".git/HEAD",
        ".gitignore",
        ".env",
        "src/main.ts",
        "src/generated/types.ts",
        "dist/bundle.js",
        "docs/guide.md",
        "docs/draft.md",
      ]) {
        await fs.mkdir(path.join(root, path.dirname(file)), {
          recursive: true,
        });
        await fs.writeFile(path.join(root, file), "");
      }
      await fs.writeFile(path.join(root, ".gitignore"), "dist/\ngenerated/\n");
      await fs.writeFile(path.join(root, "docs", ".ignore"), "draft.md\n");
    });
    afterEach(async () => {
      await fs.rm(root, { force: true, recursive: true });
    });

    it("lists what the ignore files leave in, with no hidden file", async () => {
      const files = await listRepositoryFiles(root, { timeoutMs: 30_000 });
      expect(files?.toSorted()).toEqual(["docs/guide.md", "src/main.ts"]);
    });

    it.skipIf(process.platform === "win32")(
      "lists no link, and opens nothing in the git folder a .git file points to",
      async () => {
        await fs.symlink("src", path.join(root, "linked"));
        await fs.symlink("main.ts", path.join(root, "src", "linked.ts"));
        // A worktree's `.git` file, pointing at a git folder whose files
        // are pipes: opening one would wait until the time limit.
        const gitFolder = path.join(root, ".git", "elsewhere");
        await fs.mkdir(path.join(gitFolder, "info"), { recursive: true });
        execFileSync("mkfifo", [
          path.join(gitFolder, "commondir"),
          path.join(gitFolder, "info", "exclude"),
        ]);
        await fs.mkdir(path.join(root, "worktree"));
        await fs.writeFile(path.join(root, "worktree", "file.txt"), "");
        await fs.writeFile(
          path.join(root, "worktree", ".git"),
          `gitdir: ${gitFolder}\n`,
        );
        const files = await listRepositoryFiles(root, { timeoutMs: 30_000 });
        expect(files?.toSorted()).toEqual([
          "docs/guide.md",
          "src/main.ts",
          "worktree/file.txt",
        ]);
      },
    );

    it("gives the walk a repository's names without what it ignores", async () => {
      const found = await walkFileNames({
        listRepository: (folder, timeoutMs) =>
          listRepositoryFiles(folder, { timeoutMs }),
        roots: [root],
      });
      expect(found.names).toEqual(["docs", "src", "guide.md", "main.ts"]);
    });

    it("gives no answer when ripgrep is missing or the folder is", async () => {
      expect(
        await listRepositoryFiles(root, {
          rgPath: path.join(root, "no-such-rg"),
          timeoutMs: 30_000,
        }),
      ).toBeUndefined();
      expect(
        await listRepositoryFiles(path.join(root, "missing"), {
          timeoutMs: 30_000,
        }),
      ).toBeUndefined();
    });

    it("answers with nothing for a repository whose every file is ignored", async () => {
      await fs.writeFile(path.join(root, ".gitignore"), "*\n");
      expect(await listRepositoryFiles(root, { timeoutMs: 30_000 })).toEqual(
        [],
      );
    });
  },
);
