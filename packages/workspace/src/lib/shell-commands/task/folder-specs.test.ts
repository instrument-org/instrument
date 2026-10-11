import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { noop } from "radashi";
import { describe, expect, it, vi } from "vitest";

import { MountedFolder } from "../../../schemas/mounted-folder";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { createMockChatConfig } from "../../../test/helpers/mock-chat-config";
import { getWorkspaceConfig } from "../../workspace-config";
import {
  awaitAnswers,
  parseFolderSpec,
  requireFoldersOnDisk,
  resolveFolders,
} from "./folder-specs";

describe("parseFolderSpec", () => {
  it.each([
    { expected: { name: "Home", subpath: "" }, spec: "Home" },
    { expected: { name: "Home", subpath: "" }, spec: "/mnt/Home/" },
    {
      expected: { name: "Home", subpath: "Downloads" },
      spec: "Home/Downloads",
    },
    {
      expected: { name: "Instrument", subpath: "a/b" },
      spec: "/mnt/Instrument/a/b/",
    },
  ])("reads $spec", ({ expected, spec }) => {
    expect(parseFolderSpec(spec)).toEqual(expected);
  });
});

describe("resolveFolders", () => {
  createMockChatConfig(ChatIdSchema.parse("chat"));

  const reached = {
    Home: MountedFolder.Schema.parse({
      access: "read-write",
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      mountName: "Home",
      path: "/Users/someone",
    }),
    Notes: MountedFolder.Schema.parse({
      access: "read-write",
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      mountName: "Notes",
      path: "/Volumes/Notes",
    }),
  };

  it("names each folder's host path, a whole mount or a folder inside one", () => {
    expect(resolveFolders(["Home", "/mnt/Notes/2026"], reached)).toEqual([
      { path: "/Users/someone" },
      { path: "/Volumes/Notes/2026" },
    ]);
  });

  // The home folder on a real machine: the workspace lives inside it, so the
  // whole is read-only, while a folder inside it is written in full.
  describe("a folder that holds the workspace", () => {
    const home = {
      Root: MountedFolder.Schema.parse({
        access: "read-write",
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
        mountName: "Root",
        path: path.dirname(getWorkspaceConfig().rootDir),
      }),
    };

    it("refuses the whole, naming the folder inside to add instead", () => {
      expect(() => resolveFolders(["Root"], home)).toThrow(
        "/mnt/Root holds Instrument's own data, so it is read whole and never written whole. Add the folder inside that the work needs: /mnt/Root/<folder>.",
      );
    });

    it("adds a folder inside it", () => {
      expect(resolveFolders(["Root/Desktop"], home)).toEqual([
        { path: path.join(home.Root.path, "Desktop") },
      ]);
    });

    it("refuses the workspace itself", () => {
      const workspace = `Root/${path.basename(getWorkspaceConfig().rootDir)}`;
      expect(() => resolveFolders([workspace], home)).toThrow(
        `"${workspace}" is inside Instrument's own data`,
      );
    });
  });

  it("refuses a subpath that leaves the mount", () => {
    expect(() => resolveFolders(["Home/../../etc"], reached)).toThrow(
      '"Home/../../etc" leaves /mnt/Home',
    );
    expect(() => resolveFolders(["Home/Downloads/../.."], reached)).toThrow(
      "leaves /mnt/Home",
    );
  });

  // The folder is where the path leads, not how the spec spelled the way there.
  it("keeps a subpath that only wanders inside the mount", () => {
    expect(resolveFolders(["Home/Downloads/../Desktop"], reached)).toEqual([
      { path: "/Users/someone/Desktop" },
    ]);
  });

  it("names the mounts it has when asked for one it does not", () => {
    expect(() => resolveFolders(["Desktop"], reached)).toThrow(
      'no folder "Desktop" in this conversation. Yours: /mnt/Home, /mnt/Notes',
    );
  });
});

describe("requireFoldersOnDisk", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "folder-specs-"));

  it("lets a folder that is there through", async () => {
    const dir = path.join(root, "new folder");
    await fs.mkdir(dir);
    await expect(
      requireFoldersOnDisk([{ path: dir }], ["Home/new folder"]),
    ).resolves.toEqual([]);
  });

  // The system's ask holds a listing until the user answers, and the command
  // cannot wait that long, so the answer comes back still to come.
  it.each([
    { expected: undefined, refusal: undefined, said: "allows" },
    {
      expected:
        /^macOS has not let Instrument into "Home\/Desktop"\. Call request_folder with folder "\/mnt\/Home\/Desktop"|^"Home\/Desktop" cannot be read/,
      refusal: Object.assign(new Error("not permitted"), { code: "EPERM" }),
      said: "declines",
    },
  ])(
    "holds the answer for when the user $said",
    async ({ expected, refusal }) => {
      const dir = path.join(root, `asked ${refusal ? "no" : "yes"}`);
      await fs.mkdir(dir);
      const realOpendir = fs.opendir.bind(fs);
      let answer: () => void = noop;
      const opendir = vi.spyOn(fs, "opendir").mockImplementation(
        (folder) =>
          new Promise((resolve, reject) => {
            answer = () => {
              if (refusal) {
                reject(refusal);
              } else {
                realOpendir(folder).then(resolve, reject);
              }
            };
          }),
      );
      try {
        const pending = await requireFoldersOnDisk(
          [{ path: dir }],
          ["Home/Desktop"],
        );
        expect(pending.map((look) => look.spec)).toEqual(["Home/Desktop"]);
        answer();
        const reason = await pending[0]?.answer;
        if (expected) {
          expect(reason).toMatch(expected);
        } else {
          expect(reason).toBeUndefined();
        }
      } finally {
        opendir.mockRestore();
      }
    },
  );

  // The case from a live session: the note named a folder the user had just
  // renamed in the Finder, the task was started on the old name, and its
  // first ls failed. The refusal names what was typed and how to look.
  it("refuses a folder that is not there, by the spec that named it", async () => {
    const gone = path.join(root, "untitled folder");
    await expect(
      requireFoldersOnDisk([{ path: gone }], ["Home/untitled folder"]),
    ).rejects.toThrow(
      `no folder at "Home/untitled folder": nothing is on disk at ${gone}`,
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
          requireFoldersOnDisk([{ path: shut }], ["Home/shut"]),
        ).rejects.toThrow(
          '"Home/shut" cannot be read by the account Instrument runs as (EACCES)',
        );
      } finally {
        await fs.chmod(shut, 0o700);
      }
    },
  );
});

describe("awaitAnswers", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "task-answers-"));

  /**
   * A folder whose look the system holds, as its ask does, until `answer` is
   * called: allowed, or declined with `refusal`.
   */
  async function askedFolder(refusal?: Error) {
    const dir = path.join(root, `asked-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir);
    const realOpendir = fs.opendir.bind(fs);
    let answer: () => void = noop;
    const opendir = vi.spyOn(fs, "opendir").mockImplementation(
      (folder) =>
        new Promise((resolve, reject) => {
          answer = () => {
            if (refusal) {
              reject(refusal);
            } else {
              realOpendir(folder).then(resolve, reject);
            }
          };
        }),
    );
    const looks = await requireFoldersOnDisk([{ path: dir }], ["Home/Desktop"]);
    opendir.mockRestore();
    return {
      answer: () => {
        answer();
      },
      looks,
    };
  }

  it("reports an answer given inside the wait: allowed leaves nothing pending", async () => {
    const { answer, looks } = await askedFolder();
    setTimeout(answer, 50);
    const startedAt = Date.now();
    await expect(awaitAnswers(looks, 5000)).resolves.toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("refuses the command when the user declines inside the wait", async () => {
    const { answer, looks } = await askedFolder(
      Object.assign(new Error("not permitted"), { code: "EPERM" }),
    );
    setTimeout(answer, 50);
    await expect(awaitAnswers(looks, 5000)).rejects.toThrow(
      /^macOS has not let Instrument into "Home\/Desktop"\. Call request_folder with folder "\/mnt\/Home\/Desktop"|^"Home\/Desktop" cannot be read/,
    );
  });

  // The case that makes a held task: the dialog is still up when the wait
  // runs out, and a refusal after that is the task's to report.
  it("hands back a look still unanswered when the wait runs out", async () => {
    const { answer, looks } = await askedFolder(
      Object.assign(new Error("not permitted"), { code: "EPERM" }),
    );
    const startedAt = Date.now();
    const pending = await awaitAnswers(looks, 200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(190);
    expect(pending.map((look) => look.spec)).toMatchInlineSnapshot(`
      [
        "Home/Desktop",
      ]
    `);
    answer();
    await expect(pending[0]?.answer).resolves.toMatch(/Home\/Desktop/);
  });

  it("does not wait at all with no yield left", async () => {
    const { looks } = await askedFolder();
    await expect(awaitAnswers(looks, -1000)).resolves.toHaveLength(1);
  });
});
