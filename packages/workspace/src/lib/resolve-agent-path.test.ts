import { APP_NAME_SLUG } from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import { AbsolutePathSchema, ChatDirSchema } from "../schemas/paths";
import { chatsDir } from "./record-folders";
import {
  applyUnicodeFallbacks,
  resolveAgentPath,
  resolveToolPath,
  resolveWritableToolPath,
} from "./resolve-agent-path";
import {
  buildWorkspaceFsLayout,
  resolveReadOnlyHostPath,
} from "./workspace-fs-layout";

function abs(filePath: string) {
  return AbsolutePathSchema.parse(filePath);
}

function attachment(id: string, folderPath: string) {
  return {
    access: "read-write" as const,
    id: MountedFolder.IdSchema.parse(id),
    path: abs(folderPath),
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
  const dir = ChatDirSchema.parse(path.join("/tmp", "task"));
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

describe("private-dir (.instrument) restriction", () => {
  const dir = ChatDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({ taskHostRoot: dir });

  it.each([
    { input: ".instrument", label: "the private dir itself" },
    { input: ".instrument/state.json", label: "a relative private file" },
    { input: "./.instrument/chat.db", label: "a dot-relative private file" },
  ])("rejects $label via resolveToolPath", ({ input }) => {
    const result = resolveToolPath(layout, input);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("execute-error");
      expect(result.error.message).toMatch(/private .* directory/);
    }
  });

  it.each([
    { input: `${dir}/.instrument`, label: "the full path of the private dir" },
    {
      input: `${dir}/.instrument/state.json`,
      label: "the full path of a private file",
    },
    { input: `${dir}/.INSTRUMENT/state.json`, label: "an uppercase spelling" },
    { input: `${dir}/.Instrument`, label: "a mixed-case spelling" },
  ])("rejects $label via resolveAgentPath", ({ input }) => {
    const result = resolveAgentPath({ inputPath: input, layout });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("execute-error");
      expect(result.error.message).toMatch(/private .* directory/);
    }
  });

  // The restriction is scoped to .instrument, not dot-dirs in general: the moved
  // agent-facing outputs under work/ stay readable.
  it.each(["work/screenshots/shot.png", "work/.tool-output/part-1.log"])(
    "still allows agent-facing output path %s",
    (input) => {
      expect(resolveToolPath(layout, input).isOk()).toBe(true);
    },
  );

  describe("a folder's private dir", () => {
    // A folder the user attached is theirs, and a directory of that name in it
    // is an ordinary one rather than ours to hide.
    it("leaves a folder's own .instrument dir alone", () => {
      const attachedLayout = buildWorkspaceFsLayout({
        folders: { a: attachment("id-a", "/ext/one/Docs") },
        taskHostRoot: dir,
      });

      expect(
        resolveAgentPath({
          inputPath: "/ext/one/Docs/.instrument/notes.md",
          layout: attachedLayout,
        }).isOk(),
      ).toBe(true);
    });
  });
});

// A chat's folder may hold a tasks/ dir an earlier version kept its tasks in,
// each with its private dir, and the folder mounts writable at /task, so none
// of these resolvers may reach that dir through it.
describe("a chat's tasks dir", () => {
  const chat = ChatDirSchema.parse(path.join(chatsDir(), "2026-09-26-chat"));
  const childId = "2026-09-26-child";
  const layout = buildWorkspaceFsLayout({ taskHostRoot: chat });

  it.each([
    `tasks/${childId}/.instrument/settings.json`,
    `tasks/${childId}/output/report.md`,
    "tasks",
    `${chat}/tasks/${childId}/.instrument/settings.json`,
    `${chat}/tasks/${childId}/output/report.md`,
    `${chat}/TASKS/${childId}/output/report.md`,
  ])("refuses %s for reading and writing", (input) => {
    const read = resolveAgentPath({ inputPath: input, layout });
    expect(read.isErr()).toBe(true);
    if (read.isErr()) {
      expect(read.error.message).toMatch(/tasks\/ directory|private/);
    }
    expect(resolveWritableToolPath({ inputPath: input, layout }).isErr()).toBe(
      true,
    );
  });

  it("refuses the read-only host path a real binary receives", () => {
    expect(
      resolveReadOnlyHostPath(layout, `${chat}/tasks/${childId}`),
    ).toBeNull();
  });

  it("leaves the chat's own files writable", () => {
    expect(
      resolveWritableToolPath({
        inputPath: "attachments/brief.md",
        layout,
      }).isOk(),
    ).toBe(true);
    expect(
      resolveWritableToolPath({
        inputPath: "work/tasks/notes.md",
        layout,
      }).isOk(),
    ).toBe(true);
  });

  // Only a chat's folder holds its tasks; a task's own `tasks` folder is an
  // ordinary one of its own.
  it("leaves a task's own tasks folder alone", () => {
    const task = buildWorkspaceFsLayout({
      taskHostRoot: ChatDirSchema.parse(path.join("/tmp", "task")),
    });
    expect(
      resolveWritableToolPath({
        inputPath: "tasks/todo.md",
        layout: task,
      }).isOk(),
    ).toBe(true);
  });
});

describe("another chat's folder, reached through a folder that holds the workspace", () => {
  const chat = ChatDirSchema.parse(path.join(chatsDir(), "2026-09-26-chat"));
  const other = path.join(chatsDir(), "2026-09-26-other", "work", "notes.md");
  const layout = buildWorkspaceFsLayout({
    folders: {
      above: attachment("id-above", path.dirname(chatsDir())),
    },
    taskHostRoot: chat,
  });

  it("answers as missing for reading and writing", () => {
    const read = resolveAgentPath({ inputPath: other, layout });
    expect(read.isErr() && read.error.message).toMatch(/No such file/);
    expect(resolveWritableToolPath({ inputPath: other, layout }).isErr()).toBe(
      true,
    );
  });
});

describe("resolveAgentPath (full paths)", () => {
  const dir = ChatDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({
    folders: { a: attachment("id-a", "/ext/one/Docs") },
    taskHostRoot: dir,
  });

  it("resolves the chat's folder path into the chat like a relative path", () => {
    const result = resolveAgentPath({
      inputPath: "/tmp/task/work/notes.md",
      layout,
    });
    expect(result._unsafeUnwrap()).toEqual({
      absolutePath: "/tmp/task/work/notes.md",
      displayPath: "./work/notes.md",
      mount: null,
    });
  });

  it("resolves the chat's folder itself to the chat's root", () => {
    const result = resolveAgentPath({ inputPath: "/tmp/task", layout });
    expect(result._unsafeUnwrap()).toEqual({
      absolutePath: "/tmp/task",
      displayPath: "./",
      mount: null,
    });
  });

  it("resolves a path in a folder the chat reaches to itself", () => {
    const result = resolveAgentPath({
      inputPath: "/ext/one/Docs/report.pdf",
      layout,
    });
    const value = result._unsafeUnwrap();
    expect(value.absolutePath).toBe("/ext/one/Docs/report.pdf");
    expect(value.displayPath).toBe("/ext/one/Docs/report.pdf");
    expect(value.mount?.hostRoot).toBe("/ext/one/Docs");
  });

  it("rejects a path outside every folder, pointing at request_folder", () => {
    const result = resolveAgentPath({ inputPath: "/etc/passwd", layout });
    const message = result._unsafeUnwrapErr().message;
    expect(message).toContain('"/etc/passwd" is not in a folder you reach');
    expect(message).toContain("request_folder");
  });

  it("rejects traversal out of the chat's folder through ..", () => {
    const result = resolveAgentPath({
      inputPath: "/tmp/task/../etc",
      layout,
    });
    expect(result.isErr()).toBe(true);
  });
});

describe("resolveWritableToolPath", () => {
  const dir = ChatDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({
    folders: { a: attachment("id-a", "/ext/one/Docs") },
    taskHostRoot: dir,
  });

  it("resolves relative and full paths into the chat", () => {
    expect(
      resolveWritableToolPath({ inputPath: "output/report.md", layout })
        ._unsafeUnwrap()
        .absolutePath.toString(),
    ).toBe("/tmp/task/output/report.md");
    expect(
      resolveWritableToolPath({
        inputPath: "/tmp/task/output/report.md",
        layout,
      })
        ._unsafeUnwrap()
        .absolutePath.toString(),
    ).toBe("/tmp/task/output/report.md");
  });

  it("resolves a write into a folder the chat reaches", () => {
    const resolved = resolveWritableToolPath({
      inputPath: "/ext/one/Docs/report.pdf",
      layout,
    })._unsafeUnwrap();
    expect(resolved.absolutePath).toBe("/ext/one/Docs/report.pdf");
  });

  it("rejects a write the rules keep from a folder, and still allows a read", () => {
    const held = buildWorkspaceFsLayout({
      folders: { a: attachment("id-a", "/ext/one/Docs") },
      rules: {
        home: "/Users/sam",
        rules: [{ level: "readOnly", path: "/ext/one/Docs", source: "system" }],
        withoutAsking: false,
      },
      taskHostRoot: dir,
    });
    const write = resolveWritableToolPath({
      inputPath: "/ext/one/Docs/report.pdf",
      layout: held,
    });
    expect(write._unsafeUnwrapErr().message).toContain("is read-only");
    expect(
      resolveAgentPath({
        inputPath: "/ext/one/Docs/report.pdf",
        layout: held,
      }).isOk(),
    ).toBe(true);
  });

  it("rejects unknown absolute write targets", () => {
    const result = resolveWritableToolPath({
      inputPath: "/etc/passwd",
      layout,
    });
    expect(result.isErr()).toBe(true);
  });
});

describe("symlink containment in a folder", () => {
  let tmpDir: string;
  let layout: ReturnType<typeof buildWorkspaceFsLayout>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-mount-`),
    );
    await fs.mkdir(path.join(tmpDir, "task"));
    await fs.mkdir(path.join(tmpDir, "Docs"));
    await fs.mkdir(path.join(tmpDir, "outside"));
    await fs.writeFile(path.join(tmpDir, "outside", "existing.txt"), "secret");
    await fs.symlink(
      path.join(tmpDir, "outside"),
      path.join(tmpDir, "Docs", "escape"),
    );
    layout = buildWorkspaceFsLayout({
      folders: { Docs: attachment("docs", path.join(tmpDir, "Docs")) },
      taskHostRoot: ChatDirSchema.parse(path.join(tmpDir, "task")),
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  it("resolves a plain path inside the mount", () => {
    const result = resolveWritableToolPath({
      inputPath: path.join(tmpDir, "Docs", "notes.md"),
      layout,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.absolutePath).toBe(
        path.join(tmpDir, "Docs", "notes.md"),
      );
    }
  });

  // Containment cannot rely on the target existing: a write creates the path,
  // and the directories leading to it may not exist either.
  it.each([
    { input: "escape/existing.txt", label: "an existing file" },
    { input: "escape/new-file.txt", label: "a file yet to be created" },
    {
      input: "escape/deeper/new-file.txt",
      label: "a file under directories yet to be created",
    },
  ])("refuses $label behind a symlink out of the folder", ({ input }) => {
    const result = resolveWritableToolPath({
      inputPath: path.join(tmpDir, "Docs", input),
      layout,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(/resolves outside its mount/);
    }
  });
});
