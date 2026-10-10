import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { noop } from "radashi";
import { describe, expect, it, vi } from "vitest";

import { FolderAttachment } from "../../schemas/folder-attachment";
import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { getWorkspaceConfig } from "../workspace-config";
import {
  awaitAnswers,
  parseFolderSpec,
  requireFoldersOnDisk,
  resolveFolders,
} from "./task-args";

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
  createMockChatConfig(ChatIdSchema.parse("chat"));

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
      {
        access: "read-write",
        mountName: "Home",
        path: "/Users/someone",
        source: "user",
      },
      {
        access: "read-only",
        mountName: "Home/Downloads",
        path: "/Users/someone/Downloads",
        source: "user",
      },
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

    it("reads the whole and refuses to write it, naming the folder inside to add instead", () => {
      expect(resolveFolders(["Root"], home)).toEqual([
        {
          access: "read-only",
          mountName: "Root",
          path: home.Root.path,
          source: "user",
        },
      ]);
      expect(() => resolveFolders(["Root:rw"], home)).toThrow(
        "/mnt/Root holds Instrument's own data, so it is read whole and never written whole. Add the folder inside that the work needs: /mnt/Root/<folder>.",
      );
    });

    it("hands a folder inside it read and write, asked for or not", () => {
      const desktop = path.join(home.Root.path, "Desktop");
      expect(resolveFolders(["Root/Desktop:rw", "Root/Desktop"], home)).toEqual(
        [
          {
            access: "read-write",
            mountName: "Root/Desktop",
            path: desktop,
            source: "user",
          },
          {
            access: "read-write",
            mountName: "Root/Desktop",
            path: desktop,
            source: "user",
          },
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

  // The name is where the folder is, not how the spec spelled the way there.
  it("keeps a subpath that only wanders inside the mount", () => {
    expect(resolveFolders(["Home/Downloads/../Desktop"], attached)).toEqual([
      {
        access: "read-write",
        mountName: "Home/Desktop",
        path: "/Users/someone/Desktop",
        source: "user",
      },
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
    ).resolves.toEqual([]);
  });

  // The system's ask holds a listing until the user answers, and the command
  // cannot wait that long, so the answer comes back still to come.
  it.each([
    { expected: undefined, refusal: undefined, said: "allows" },
    {
      expected:
        /^macOS has not let Instrument into "Home\/Desktop:rw"\. Call request_folder with folder "\/mnt\/Home\/Desktop"|^"Home\/Desktop:rw" cannot be read/,
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
          ["Home/Desktop:rw"],
        );
        expect(pending.map((look) => look.spec)).toEqual(["Home/Desktop:rw"]);
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
    const looks = await requireFoldersOnDisk(
      [{ path: dir }],
      ["Home/Desktop:rw"],
    );
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
      /^macOS has not let Instrument into "Home\/Desktop:rw"\. Call request_folder with folder "\/mnt\/Home\/Desktop"|^"Home\/Desktop:rw" cannot be read/,
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
        "Home/Desktop:rw",
      ]
    `);
    answer();
    await expect(pending[0]?.answer).resolves.toMatch(/Home\/Desktop:rw/);
  });

  it("does not wait at all with no yield left", async () => {
    const { looks } = await askedFolder();
    await expect(awaitAnswers(looks, -1000)).resolves.toHaveLength(1);
  });
});
