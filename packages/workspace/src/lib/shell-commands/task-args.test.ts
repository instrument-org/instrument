import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { getWorkspaceConfig } from "../workspace-config";
import {
  parseFlags,
  parseFolderSpec,
  requireFoldersOnDisk,
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
