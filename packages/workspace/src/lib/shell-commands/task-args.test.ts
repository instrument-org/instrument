import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { MOUNT } from "../../mount-points";
import { FolderAttachment } from "../../schemas/folder-attachment";
import { TaskDirSchema } from "../../schemas/paths";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { getWorkspaceConfig } from "../workspace-config";
import { buildWorkspaceFsLayout } from "../workspace-fs-layout";
import {
  parseDelay,
  parseFlags,
  parseFolderSpec,
  requireFilesNamedInBrief,
  requireFoldersOnDisk,
  resolveFileUploads,
  resolveFolders,
} from "./task-args";

describe("parseFlags", () => {
  it("reads spaced and inline values, keeps the last of a flag given twice, and collects a repeatable one", () => {
    const { positional, values } = parseFlags(
      [
        "--name",
        "Lisbon",
        "--folder",
        "Home",
        "--folder=Instrument:rw",
        "--name=Porto",
        "the",
        "brief",
      ],
      { flags: ["folder", "model", "name"], repeatable: ["folder"] },
    );
    expect(positional).toEqual(["the", "brief"]);
    expect(Object.fromEntries(values)).toEqual({
      folder: ["Home", "Instrument:rw"],
      name: ["Porto"],
    });
  });

  it("leaves a flag it was not told about as a positional", () => {
    const { positional, values } = parseFlags(["--running", "x"], {
      flags: ["tail"],
      repeatable: [],
    });
    expect(positional).toEqual(["--running", "x"]);
    expect(values.size).toBe(0);
  });

  it("refuses a flag with nothing after it", () => {
    expect(() =>
      parseFlags(["--tail"], { flags: ["tail"], repeatable: [] }),
    ).toThrow("--tail needs a value.");
  });

  it("reads a switch without taking the next token as its value", () => {
    const { positional, values } = parseFlags(["--steps", "task-1"], {
      boolean: ["steps"],
      flags: ["tail"],
      repeatable: [],
    });
    expect(positional).toEqual(["task-1"]);
    expect(values.has("steps")).toBe(true);
  });
});

describe("parseDelay", () => {
  it.each([
    ["30s", 30_000],
    ["5m", 300_000],
    ["1h", 3_600_000],
    ["90 sec", 90_000],
    ["2 hours", 7_200_000],
    ["1.5m", 90_000],
    ["45", 45_000],
  ])("reads %s", (raw, expected) => {
    expect(parseDelay(raw)).toBe(expected);
  });

  it.each([["0"], ["soon"], ["5 days"], [""], ["-5m"]])("refuses %s", (raw) => {
    expect(parseDelay(raw)).toBeUndefined();
  });
});

describe("parseFolderSpec", () => {
  it.each([
    {
      expected: { access: undefined, name: "Home", subpath: "" },
      spec: "Home",
    },
    {
      expected: { access: undefined, name: "Home", subpath: "" },
      spec: "/mnt/Home/",
    },
    {
      expected: { access: "read-write", name: "Home", subpath: "Downloads" },
      spec: "Home/Downloads:rw",
    },
    {
      expected: { access: "read-only", name: "Instrument", subpath: "a/b" },
      spec: "/mnt/Instrument/a/b/:ro",
    },
    {
      expected: { access: "read-write", name: "Home", subpath: "" },
      spec: "Home:read-write",
    },
  ])("reads $spec", ({ expected, spec }) => {
    expect(parseFolderSpec(spec)).toEqual(expected);
  });
});

describe("resolveFolders", () => {
  createMockTaskConfig(TaskIdSchema.parse("orchestrator"));

  const attached = {
    Home: FolderAttachment.Schema.parse({
      access: "read-write",
      createdAt: 1,
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      mountName: "Home",
      path: "/Users/someone",
      source: "user",
    }),
    Notes: FolderAttachment.Schema.parse({
      access: "read-only",
      createdAt: 2,
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      mountName: "Notes",
      path: "/Volumes/Notes",
      source: "user",
    }),
  };

  it("hands a task the conversation's access unless the spec narrows it", () => {
    expect(resolveFolders(["Home", "Home/Downloads:ro"], attached)).toEqual([
      { access: "read-write", path: "/Users/someone", source: "user" },
      { access: "read-only", path: "/Users/someone/Downloads", source: "user" },
    ]);
  });

  it("refuses write access to a folder the conversation only reads", () => {
    expect(() => resolveFolders(["Notes:rw"], attached)).toThrow(
      "/mnt/Notes is read-only in this conversation",
    );
  });

  // The home folder on a real machine: the workspace lives inside it, so the
  // whole is read-only, while a folder inside it takes the grant in full.
  describe("a grant that holds the workspace", () => {
    const home = {
      Root: FolderAttachment.Schema.parse({
        access: "read-write",
        createdAt: 1,
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
        mountName: "Root",
        path: path.dirname(getWorkspaceConfig().rootDir),
        source: "user",
      }),
    };

    it("reads the whole and refuses to write it, naming the folder inside to hand instead", () => {
      expect(resolveFolders(["Root"], home)).toEqual([
        { access: "read-only", path: home.Root.path, source: "user" },
      ]);
      expect(() => resolveFolders(["Root:rw"], home)).toThrow(
        "/mnt/Root holds Instrument's own data, so a task reads it whole and never writes it whole. Hand it the folder inside that the work needs: --folder /mnt/Root/<folder>:rw.",
      );
    });

    it("hands a folder inside it read and write, asked for or not", () => {
      const desktop = path.join(home.Root.path, "Desktop");
      expect(resolveFolders(["Root/Desktop:rw", "Root/Desktop"], home)).toEqual(
        [
          { access: "read-write", path: desktop, source: "user" },
          { access: "read-write", path: desktop, source: "user" },
        ],
      );
    });

    it("keeps the workspace itself read-only under that grant", () => {
      const workspace = `Root/${path.basename(getWorkspaceConfig().rootDir)}`;
      expect(() => resolveFolders([`${workspace}:rw`], home)).toThrow(
        "/mnt/Root is read-only in this conversation",
      );
    });
  });

  it("refuses a subpath that leaves the mount", () => {
    expect(() => resolveFolders(["Home/../../etc"], attached)).toThrow(
      '"Home/../../etc" leaves /mnt/Home',
    );
    expect(() => resolveFolders(["Home/Downloads/../.."], attached)).toThrow(
      "leaves /mnt/Home",
    );
  });

  it("keeps a subpath that only wanders inside the mount", () => {
    expect(resolveFolders(["Home/Downloads/../Desktop"], attached)).toEqual([
      { access: "read-write", path: "/Users/someone/Desktop", source: "user" },
    ]);
  });

  it("names the mounts it has when asked for one it does not", () => {
    expect(() => resolveFolders(["Desktop"], attached)).toThrow(
      'no folder "Desktop" in this conversation. Yours: /mnt/Home, /mnt/Notes',
    );
  });
});

describe("requireFoldersOnDisk", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "task-folders-"));

  it("lets a folder that is there through", async () => {
    const dir = path.join(root, "new folder");
    await fs.mkdir(dir);
    await expect(
      requireFoldersOnDisk([{ path: dir }], ["Home/new folder:rw"]),
    ).resolves.toBeUndefined();
  });

  // The case from a live session: the note named a folder the user had just
  // renamed in the Finder, the task was started on the old name, and its
  // first ls failed. The refusal names what was typed and how to look.
  it("refuses a folder that is not there, by the spec that named it", async () => {
    const gone = path.join(root, "untitled folder");
    await expect(
      requireFoldersOnDisk([{ path: gone }], ["Home/untitled folder:rw"]),
    ).rejects.toThrow(
      `no folder at "Home/untitled folder:rw": nothing is on disk at ${gone}`,
    );
  });

  it("refuses a file where a folder was meant", async () => {
    const file = path.join(root, "notes.txt");
    await fs.writeFile(file, "notes");
    await expect(
      requireFoldersOnDisk([{ path: file }], ["Home/notes.txt"]),
    ).rejects.toThrow('"Home/notes.txt" is a file, not a folder');
  });

  // Root reads a folder whatever its mode says, so the refusal cannot be
  // provoked there.
  it.skipIf(process.getuid?.() === 0)(
    "refuses a folder the account cannot look into",
    async () => {
      const shut = path.join(root, "shut");
      await fs.mkdir(shut, { mode: 0o000 });
      try {
        await expect(
          requireFoldersOnDisk([{ path: shut }], ["Home/shut:rw"]),
        ).rejects.toThrow(
          '"Home/shut:rw" cannot be read by the account Instrument runs as (EACCES)',
        );
      } finally {
        await fs.chmod(shut, 0o700);
      }
    },
  );
});

describe("resolveFileUploads", () => {
  createMockTaskConfig(TaskIdSchema.parse("orchestrator"));
  const root = mkdtempSync(path.join(os.tmpdir(), "task-files-"));
  const taskHostRoot = TaskDirSchema.parse(path.join(root, "conversation"));
  const desktop = path.join(root, "Desktop");
  const layout = buildWorkspaceFsLayout({
    attachedFolders: {
      Desktop: FolderAttachment.Schema.parse({
        access: "read-write",
        createdAt: 1,
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
        mountName: "Desktop",
        path: desktop,
        source: "user",
      }),
    },
    taskHostRoot,
  });

  beforeAll(async () => {
    await fs.mkdir(path.join(taskHostRoot, "attachments"), { recursive: true });
    await fs.mkdir(path.join(taskHostRoot, ".instrument"), { recursive: true });
    await fs.mkdir(desktop, { recursive: true });
    await fs.writeFile(
      path.join(taskHostRoot, "attachments", "screen.png"),
      "png bytes",
    );
    await fs.writeFile(path.join(taskHostRoot, ".instrument", "task.db"), "");
    await fs.writeFile(path.join(desktop, "report.pdf"), "pdf bytes");
  });

  // The file the user sent, as the note names it: bare, from the shell's
  // working directory, and again by its absolute path.
  it("reads a sent file by its bare name and by its path, from the conversation's folder or a mount", async () => {
    const files = await resolveFileUploads(
      [
        "attachments/screen.png",
        "/task/attachments/screen.png",
        "/mnt/Desktop/report.pdf",
      ],
      { cwd: MOUNT.task, layout },
    );
    expect(files).toEqual([
      {
        filename: "screen.png",
        mimeType: "image/png",
        path: path.join(taskHostRoot, "attachments", "screen.png"),
        size: 9,
      },
      {
        filename: "screen.png",
        mimeType: "image/png",
        path: path.join(taskHostRoot, "attachments", "screen.png"),
        size: 9,
      },
      {
        filename: "report.pdf",
        mimeType: "application/pdf",
        path: path.join(desktop, "report.pdf"),
        size: 9,
      },
    ]);
  });

  it("counts a relative spec from the working directory", async () => {
    const files = await resolveFileUploads(["report.pdf"], {
      cwd: `${MOUNT.attachedFolders}/Desktop`,
      layout,
    });
    expect(files).toEqual([
      {
        filename: "report.pdf",
        mimeType: "application/pdf",
        path: path.join(desktop, "report.pdf"),
        size: 9,
      },
    ]);
  });

  it("refuses a file that is not there, by the spec that named it", async () => {
    await expect(
      resolveFileUploads(["attachments/gone.png"], { cwd: MOUNT.task, layout }),
    ).rejects.toThrow(
      'no file at "attachments/gone.png": nothing is on disk there',
    );
  });

  it("refuses a folder, naming --folder", async () => {
    await expect(
      resolveFileUploads(["/mnt/Desktop"], { cwd: MOUNT.task, layout }),
    ).rejects.toThrow(
      '"/mnt/Desktop" is a folder. --file hands a task one file; a folder goes with --folder.',
    );
  });

  it("refuses the conversation's private folder", async () => {
    await expect(
      resolveFileUploads([".instrument/task.db"], { cwd: MOUNT.task, layout }),
    ).rejects.toThrow('no file at ".instrument/task.db"');
  });
});

describe("requireFilesNamedInBrief", () => {
  it("lets a brief through when every file it names in the conversation's folder is handed over", () => {
    expect(() => {
      requireFilesNamedInBrief(
        "Look at /task/attachments/status.png and attachments/notes.txt, then answer.",
        ["/task/attachments/status.png", "attachments/notes.txt"],
        MOUNT.task,
      );
    }).not.toThrow();
  });

  it("matches a bare name against the same file handed by its full path", () => {
    expect(() => {
      requireFilesNamedInBrief(
        "Read attachments/status.png.",
        ["/task/attachments/status.png"],
        MOUNT.task,
      );
    }).not.toThrow();
  });

  // The move every model made first: the file named in the brief, in the
  // conversation's own folder, and no --file. The refusal carries the flag.
  it("refuses a brief that names a file in the conversation's folder without --file", () => {
    expect(() => {
      requireFilesNamedInBrief(
        "Look at the attached image /task/attachments/status.png (a copy is in your attachments folder).",
        [],
        MOUNT.task,
      );
    }).toThrow(
      "the brief names \"/task/attachments/status.png\" in this conversation's own folder, which no task can see. Add --file /task/attachments/status.png: a copy lands in the task's own attachments/ under the same name.",
    );
  });

  it("leaves a mount's attachments folder and a task's bare folder alone", () => {
    expect(() => {
      requireFilesNamedInBrief(
        "Read /mnt/Home/attachments/old.png and put results in your attachments/ folder; see /tasks/one/attachments/a.txt.",
        [],
        MOUNT.task,
      );
    }).not.toThrow();
  });
});
