import { APP_NAME_SLUG } from "@instrument-org/shared";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { recordMovedPaths } from "./moved-paths";
import { chatsDir } from "./record-folders";
import {
  applyUnicodeFallbacks,
  resolveAgentPath,
  resolveToolPath,
  resolveWritableToolPath,
} from "./resolve-agent-path";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";
import {
  buildWorkspaceFsLayout,
  resolveReadOnlyHostPath,
  type WorkspaceFsLayout,
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
  const dir = WorkDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({ chatHostRoot: dir });

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
        /not relative|escapes the chat's folder/,
      );
    }
  });
});

describe("dot folders", () => {
  const dir = WorkDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({ chatHostRoot: dir });

  it.each([
    ".instrument/notes.md",
    "work/screenshots/shot.png",
    "work/.tool-output/part-1.log",
  ])("reads %s in the work folder like any other path", (input) => {
    expect(resolveToolPath(layout, input).isOk()).toBe(true);
  });

  // A folder the user attached is theirs, and a directory of that name in it
  // is an ordinary one rather than ours to hide.
  it("leaves a folder's own .instrument dir alone", () => {
    const attachedLayout = buildWorkspaceFsLayout({
      folders: { a: attachment("id-a", "/ext/one/Docs") },
      chatHostRoot: dir,
    });

    expect(
      resolveAgentPath({
        inputPath: "/ext/one/Docs/.instrument/notes.md",
        layout: attachedLayout,
      }).isOk(),
    ).toBe(true);
  });

  // A tasks folder in the work folder is one the agent made.
  it.each(["tasks/todo.md", "work/tasks/notes.md", "attachments/brief.md"])(
    "leaves %s in the work folder writable",
    (input) => {
      expect(resolveWritableToolPath({ inputPath: input, layout }).isOk()).toBe(
        true,
      );
    },
  );
});

describe("another chat's folders, reached through a folder that holds them", () => {
  const { rootDir, workspaceMachineDir } = getWorkspaceConfig();
  const workFolders = path.join(workspaceMachineDir, "work");
  const layout = buildWorkspaceFsLayout({
    folders: {
      // Above both the workspace and this computer's folder for it.
      above: attachment("id-above", path.dirname(rootDir)),
    },
    chatHostRoot: WorkDirSchema.parse(
      path.join(workFolders, "2026-09-26-chat"),
    ),
    recordHostRoot: ChatDirSchema.parse(
      path.join(chatsDir(), "2026-09-26-chat"),
    ),
  });

  it.each([
    ["its records", path.join(chatsDir(), "2026-09-26-other", "chat.db")],
    [
      "what it was sent",
      path.join(chatsDir(), "2026-09-26-other", "attachments", "a.png"),
    ],
    [
      "its work folder",
      path.join(workFolders, "2026-09-26-other", "work", "notes.md"),
    ],
  ])("refuses %s plainly for reading and writing", (_label, other) => {
    const read = resolveAgentPath({ inputPath: other, layout });
    expect(read.isErr() && read.error.message).toMatch(
      /is Instrument's own data, which no command reads or changes/,
    );
    expect(resolveWritableToolPath({ inputPath: other, layout }).isErr()).toBe(
      true,
    );
  });
});

// A chat's records and its work are two folders: the record folder in the
// workspace, which the rules close but for what the person sent and the
// agent's handoff notes, and the work folder in this computer's folder for
// the workspace, where the shell starts.
describe("a chat's record folder apart from its work folder", () => {
  let previous: ReturnType<typeof getWorkspaceConfig>;
  let tmpDir: string;
  let machineDir: string;
  let record: string;
  let work: string;
  let layout: WorkspaceFsLayout;

  beforeEach(async () => {
    previous = getWorkspaceConfig();
    tmpDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), `${APP_NAME_SLUG}-records-`)),
    );
    const rootDir = path.join(tmpDir, "workspace");
    machineDir = path.join(tmpDir, "machine");
    setWorkspaceConfig({
      ...previous,
      chatsDir: abs(workspaceLayout(rootDir).chatsDir),
      rootDir: WorkspaceDirSchema.parse(rootDir),
      workFoldersDir: abs(path.join(machineDir, "work")),
      workspaceMachineDir: abs(machineDir),
    });
    record = path.join(workspaceLayout(rootDir).chatsDir, "2026-10-13-chat");
    work = path.join(machineDir, "work", "2026-10-13-chat");
    await fs.mkdir(path.join(record, "attachments"), { recursive: true });
    await fs.mkdir(work, { recursive: true });
    await fs.writeFile(path.join(record, "attachments", "sent.txt"), "sent");
    await fs.writeFile(path.join(record, "settings.json"), "{}");
    layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(work),
      recordHostRoot: ChatDirSchema.parse(record),
    });
  });

  afterEach(async () => {
    setWorkspaceConfig(previous);
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  it("reads attachments/ in the record folder when the work folder has none", () => {
    const resolved = resolveAgentPath({
      inputPath: "attachments/sent.txt",
      layout,
    })._unsafeUnwrap();
    expect(resolved.absolutePath).toBe(
      path.join(record, "attachments", "sent.txt"),
    );
    expect(resolved.displayPath).toBe(
      path.join(record, "attachments", "sent.txt"),
    );
    expect(resolved.mount).toBe(layout.record);
  });

  it("reads attachments/ in the work folder first", async () => {
    await fs.mkdir(path.join(work, "attachments"));
    await fs.writeFile(path.join(work, "attachments", "sent.txt"), "made");

    expect(
      resolveAgentPath({
        inputPath: "./attachments/sent.txt",
        layout,
      })._unsafeUnwrap(),
    ).toEqual({
      absolutePath: path.join(work, "attachments", "sent.txt"),
      displayPath: "./attachments/sent.txt",
      mount: null,
    });
  });

  it("names the work folder for an attachment neither folder has", () => {
    expect(
      resolveAgentPath({
        inputPath: "attachments/gone.txt",
        layout,
      })._unsafeUnwrap().absolutePath,
    ).toBe(path.join(work, "attachments", "gone.txt"));
  });

  it("refuses to change what the person sent, and writes a relative path into the work folder", () => {
    const write = resolveWritableToolPath({
      inputPath: path.join(record, "attachments", "new.txt"),
      layout,
    });
    expect(write._unsafeUnwrapErr().message).toContain("read-only");
    expect(
      resolveWritableToolPath({
        inputPath: "attachments/new.txt",
        layout,
      })._unsafeUnwrap().absolutePath,
    ).toBe(path.join(work, "attachments", "new.txt"));
    expect(
      resolveReadOnlyHostPath(layout, path.join(record, "attachments")),
    ).toBe(path.join(record, "attachments"));
  });

  it("writes and reads the handoff notes", async () => {
    const notes = path.join(record, "handoff-notes.md");
    expect(
      resolveWritableToolPath({
        inputPath: notes,
        layout,
      })._unsafeUnwrap().absolutePath,
    ).toBe(notes);
    await fs.writeFile(notes, "notes");
    expect(
      resolveAgentPath({ inputPath: notes, layout })._unsafeUnwrap()
        .absolutePath,
    ).toBe(notes);
  });

  it.each(["settings.json", "chat.db", "planted.md", ""])(
    "keeps '%s' in the record folder from the agent",
    (name) => {
      const target = name === "" ? record : path.join(record, name);
      const read = resolveAgentPath({ inputPath: target, layout });
      expect(read.isErr() && read.error.message).toMatch(
        /is Instrument's own data, which no command reads or changes/,
      );
      expect(
        resolveWritableToolPath({ inputPath: target, layout }).isErr(),
      ).toBe(true);
      expect(resolveReadOnlyHostPath(layout, target)).toBeNull();
    },
  );

  describe("a path into the folder before its work moved", () => {
    beforeEach(async () => {
      recordMovedPaths(machineDir, [
        { from: path.dirname(record), to: path.join(machineDir, "work") },
      ]);
      await fs.mkdir(path.join(work, "work"), { recursive: true });
      await fs.writeFile(path.join(work, "work", "report.md"), "report");
    });

    it("reads where the move took it", () => {
      expect(
        resolveAgentPath({
          inputPath: path.join(record, "work", "report.md"),
          layout,
        })._unsafeUnwrap(),
      ).toEqual({
        absolutePath: path.join(work, "work", "report.md"),
        displayPath: "./work/report.md",
        mount: null,
      });
    });

    it("reads what stayed where it was", () => {
      expect(
        resolveAgentPath({
          inputPath: path.join(record, "attachments", "sent.txt"),
          layout,
        })._unsafeUnwrap().absolutePath,
      ).toBe(path.join(record, "attachments", "sent.txt"));
    });

    it("follows no move for a write", () => {
      expect(
        resolveWritableToolPath({
          inputPath: path.join(record, "work", "report.md"),
          layout,
        }).isErr(),
      ).toBe(true);
    });

    it("keeps another chat's moved work from the agent", async () => {
      const other = path.join(machineDir, "work", "2026-10-13-other", "work");
      await fs.mkdir(other, { recursive: true });
      await fs.writeFile(path.join(other, "theirs.md"), "theirs");
      const typed = path.join(
        path.dirname(record),
        "2026-10-13-other",
        "work",
        "theirs.md",
      );
      const read = resolveAgentPath({ inputPath: typed, layout });
      expect(read.isErr()).toBe(true);
      // About the path it named, never the one the move would have led to.
      const message = read.isErr() ? read.error.message : "";
      expect(message).toContain(typed);
      expect(message).not.toContain(machineDir);
      expect(existsSync(path.join(other, "theirs.md"))).toBe(true);
    });
  });
});

describe("resolveAgentPath (full paths)", () => {
  const dir = WorkDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({
    folders: { a: attachment("id-a", "/ext/one/Docs") },
    chatHostRoot: dir,
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
  const dir = WorkDirSchema.parse(path.join("/tmp", "task"));
  const layout = buildWorkspaceFsLayout({
    folders: { a: attachment("id-a", "/ext/one/Docs") },
    chatHostRoot: dir,
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
      chatHostRoot: dir,
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
      chatHostRoot: WorkDirSchema.parse(path.join(tmpDir, "task")),
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
      expect(result.error.message).toMatch(/resolves outside its folder/);
    }
  });
});
