import { APP_NAME_SLUG } from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema, TaskDirSchema } from "../schemas/paths";
import {
  applyUnicodeFallbacks,
  resolveAgentPath,
  resolveToolPath,
  resolveWritableToolPath,
} from "./resolve-agent-path";
import { buildWorkspaceFsLayout } from "./workspace-fs-layout";

function abs(filePath: string) {
  return AbsolutePathSchema.parse(filePath);
}

function attachment(id: string, name: string, folderPath: string) {
  return {
    createdAt: 0,
    id: FolderAttachment.IdSchema.parse(id),
    name,
    path: abs(folderPath),
    source: "user" as const,
  };
}

describe("applyUnicodeFallbacks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-unicode-test-`),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  it("returns the original path when the file exists as-is", async () => {
    const file = path.join(tmpDir, "normal.txt");
    await fs.writeFile(file, "");
    expect(applyUnicodeFallbacks(abs(file))).toBe(file);
  });

  it("returns the original path when no variant exists", () => {
    const file = abs(path.join(tmpDir, "nonexistent.txt"));
    expect(applyUnicodeFallbacks(file)).toBe(file);
  });

  it.each([
    {
      label: "AM screenshot",
      // File on disk uses U+202F (narrow no-break space) before AM
      diskName: `Screenshot 2025-01-01 at 9.00\u202FAM.png`,
      inputName: `Screenshot 2025-01-01 at 9.00 AM.png`,
    },
    {
      diskName: `Screenshot 2025-01-01 at 3.45\u202FPM.png`,
      inputName: `Screenshot 2025-01-01 at 3.45 PM.png`,
      label: "PM screenshot",
    },
  ])(
    "resolves macOS $label filename (U+202F narrow no-break space)",
    async ({ diskName, inputName }) => {
      await fs.writeFile(path.join(tmpDir, diskName), "");
      const input = abs(path.join(tmpDir, inputName));
      const result = applyUnicodeFallbacks(input);
      expect(result).toBe(path.join(tmpDir, diskName));
    },
  );

  it("resolves NFD-encoded filename (macOS decomposed Unicode)", async () => {
    // cspell:ignore APFS
    // Write a file using the NFD form of the name. On APFS the OS normalizes
    // it to NFC on disk, so the NFC input path finds it directly. On HFS+ the
    // OS preserves NFD and the fallback is needed. Either way the returned
    // path must be accessible.
    const nfcName = "caf\u00E9.txt"; // NFC: é as single codepoint
    const nfdName = "cafe\u0301.txt"; // NFD: e + combining acute accent
    await fs.writeFile(path.join(tmpDir, nfdName), "");
    const input = abs(path.join(tmpDir, nfcName));
    const result = applyUnicodeFallbacks(input);
    await expect(fs.access(result)).resolves.toBeUndefined();
  });

  it("resolves curly apostrophe in filename (macOS U+2019)", async () => {
    // cspell:ignore d'écran cran
    // macOS uses U+2019 in names like "Capture d'écran"
    const diskName = "Capture d\u2019\u00E9cran.png";
    const inputName = "Capture d'écran.png";
    await fs.writeFile(path.join(tmpDir, diskName), "");
    const input = abs(path.join(tmpDir, inputName));
    const result = applyUnicodeFallbacks(input);
    expect(result).toBe(path.join(tmpDir, diskName));
  });

  it("resolves combined NFD + curly apostrophe (French macOS screenshot)", async () => {
    // French macOS: NFD-encoded é AND curly apostrophe.
    // The OS may normalize the NFD part on disk; what matters is the file is found.
    const diskName = `Capture d\u2019e\u0301cran.png`; // NFD + U+2019
    const inputName = `Capture d'écran.png`; // NFC + straight apostrophe
    await fs.writeFile(path.join(tmpDir, diskName), "");
    const input = abs(path.join(tmpDir, inputName));
    const result = applyUnicodeFallbacks(input);
    expect(result).not.toBe(input);
    await expect(fs.access(result)).resolves.toBeUndefined();
  });
});

describe("resolveToolPath", () => {
  const dir = TaskDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({ taskHostRoot: dir });

  it.each([
    {
      displayPath: "./src/index.ts",
      input: "./src/index.ts",
      label: "normal relative path",
    },
    { displayPath: "./file.txt", input: "file.txt", label: "bare filename" },
    {
      displayPath: "./nested/dir/file.ts",
      input: "nested/dir/file.ts",
      label: "nested path",
    },
  ])(
    "resolves $label to absolutePath + displayPath",
    ({ displayPath, input }) => {
      const result = resolveToolPath(layout, input);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.displayPath).toBe(displayPath);
        expect(result.value.absolutePath).toBe(
          path.join("/tmp", "task", displayPath),
        );
      }
    },
  );

  it.each([
    { input: "../outside.txt", label: "forward-slash parent traversal" },
    { input: "src/../../outside.txt", label: "nested forward-slash traversal" },
    {
      input: "./subdir\\..\\..\\outside.txt",
      label: "Windows backslash traversal",
    },
    {
      input: "./a\\..\\..\\b\\..\\..\\outside.txt",
      label: "multi-segment backslash traversal",
    },
  ])("rejects $label with execute-error", ({ input }) => {
    const result = resolveToolPath(layout, input);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("execute-error");
      expect(result.error.message).toMatch(
        /not relative|escapes the task directory/,
      );
    }
  });
});

describe("resolveAgentPath (virtual layout paths)", () => {
  const dir = TaskDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({
    attachedFolders: {
      a: attachment("id-a", "Docs", "/ext/one/Docs"),
      b: attachment("id-b", "Docs", "/ext/two/Docs"),
    },
    taskHostRoot: dir,
  });

  it("resolves /task/... into the task like a relative path", () => {
    const result = resolveAgentPath({
      inputPath: "/task/work/notes.md",
      layout,
    });
    expect(result._unsafeUnwrap()).toEqual({
      absolutePath: "/tmp/task/work/notes.md",
      displayPath: "./work/notes.md",
      mount: null,
    });
  });

  it("resolves /task itself to the task root", () => {
    const result = resolveAgentPath({ inputPath: "/task", layout });
    expect(result._unsafeUnwrap()).toEqual({
      absolutePath: "/tmp/task",
      displayPath: "./",
      mount: null,
    });
  });

  it("resolves a mount path to the attached folder's host path", () => {
    const result = resolveAgentPath({
      inputPath: "/mnt/Docs/report.pdf",
      layout,
    });
    const value = result._unsafeUnwrap();
    expect(value.absolutePath).toBe("/ext/one/Docs/report.pdf");
    expect(value.displayPath).toBe("/mnt/Docs/report.pdf");
    expect(value.mount?.readOnly).toBe(true);
  });

  it("resolves a deduplicated mount path to the second same-named folder", () => {
    const result = resolveAgentPath({
      inputPath: "/mnt/Docs (2)/report.pdf",
      layout,
    });
    expect(result._unsafeUnwrap().absolutePath).toBe(
      "/ext/two/Docs/report.pdf",
    );
  });

  it("steers a real host path to its assigned mount path", () => {
    const result = resolveAgentPath({
      inputPath: "/ext/two/Docs/report.pdf",
      layout,
    });
    // The second same-named folder gets a deduplicated mount point; the
    // steering error must advertise that assigned path, not a recomputed one.
    expect(result._unsafeUnwrapErr().message).toContain('"/mnt/Docs (2)/..."');
  });

  it("rejects unknown absolute paths, listing the available mounts", () => {
    const result = resolveAgentPath({ inputPath: "/etc/passwd", layout });
    const message = result._unsafeUnwrapErr().message;
    expect(message).toContain("/task");
    expect(message).toContain("/mnt/Docs");
    expect(message).toContain("/mnt/Docs (2)");
  });

  it("rejects traversal out of the task via /task/..", () => {
    const result = resolveAgentPath({ inputPath: "/task/../etc", layout });
    expect(result.isErr()).toBe(true);
  });
});

describe("resolveWritableToolPath", () => {
  const dir = TaskDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({
    attachedFolders: { a: attachment("id-a", "Docs", "/ext/one/Docs") },
    taskHostRoot: dir,
  });

  it("resolves relative and /task paths into the task", () => {
    expect(
      resolveWritableToolPath({ inputPath: "output/report.md", layout })
        ._unsafeUnwrap()
        .absolutePath.toString(),
    ).toBe("/tmp/task/output/report.md");
    expect(
      resolveWritableToolPath({ inputPath: "/task/output/report.md", layout })
        ._unsafeUnwrap()
        .absolutePath.toString(),
    ).toBe("/tmp/task/output/report.md");
  });

  it("rejects writes into a read-only mount with copy-into-task guidance", () => {
    const result = resolveWritableToolPath({
      inputPath: "/mnt/Docs/report.pdf",
      layout,
    });
    const message = result._unsafeUnwrapErr().message;
    expect(message).toContain("read-only");
    expect(message).toContain("cp '/mnt/Docs/report.pdf' attachments/");
  });

  it("rejects unknown absolute write targets", () => {
    const result = resolveWritableToolPath({
      inputPath: "/etc/passwd",
      layout,
    });
    expect(result.isErr()).toBe(true);
  });
});
