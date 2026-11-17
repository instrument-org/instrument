import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keepVersion } from "../file-versions";
import {
  fileVersionHistory,
  restoreFileVersion,
  undoableReplies,
  undoReplyFiles,
} from "./file-version-history";

/** Each session's messages, as the chat's records would read them. */
const sessions = new Map<string, unknown[]>();
let dir: string;

vi.mock("../chat-info", () => ({
  chatSessions: () =>
    Promise.resolve([...sessions.keys()].map((id) => ({ id, title: "" }))),
}));
vi.mock(import("../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionOfChat: () => "s-chat" as never,
}));
vi.mock("../resolve-workspace-file-path", () => ({
  resolveWorkspaceFilePaths: ({ filePaths }: { filePaths: string[] }) =>
    Promise.resolve(new Map(filePaths.map((at) => [at, at]))),
}));
// Reads a shell-spelled path (`/c/...` on Windows) as the agent's filesystem does.
vi.mock("../tool-fs", async () => {
  const { hostPathOf } = await import("../workspace-fs-layout");
  return {
    sessionToolFs: () =>
      Promise.resolve({
        fs: { readFileBuffer: (at: string) => fs.readFile(hostPathOf(at)) },
      }),
  };
});
vi.mock("../work-dir", () => ({ workDir: () => path.join(dir, "work") }));
vi.mock("./asks", () => ({ thisDevice: () => "mac" }));
vi.mock("../chat-reads", () => ({
  ChatReads: {
    transcript: ({ sessionId }: { sessionId: string }) =>
      Promise.resolve(ok(sessions.get(sessionId) ?? [])),
  },
}));
vi.mock("../chat-writes", () => ({
  ChatWrites: {
    savePart: (part: {
      metadata: { messageId: string; sessionId: string };
    }) => {
      const message = (
        sessions.get(part.metadata.sessionId) as
          | { id: string; parts: unknown[] }[]
          | undefined
      )?.find((each) => each.id === part.metadata.messageId);
      message?.parts.push(part);
      return Promise.resolve(ok(undefined));
    },
  },
}));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "version-history-"));
  sessions.clear();
});
afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

let minute = 0;

/** Writes `contents` to `file`, keeps a version of it, and returns its record. */
async function kept(file: string, contents: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  const version = await keepVersion({
    file,
    folder: path.join(dir, "work", ".versions"),
    label: contents,
    now: new Date(2026, 10, 15, 12, minute++),
  });
  return {
    copy: version?.copy,
    hash: version?.hash,
    hostPath: file,
    path: path.basename(file),
    size: version?.size,
  };
}

/** A turn: the ask, then a reply carrying `parts`, each `[records, kind?]`. */
function turn(
  sessionId: string,
  id: string,
  parts: [Awaited<ReturnType<typeof kept>>[], string?][],
) {
  const messages = sessions.get(sessionId) ?? [];
  sessions.set(sessionId, messages);
  const createdAt = new Date(2026, 10, 15, 12, minute++);
  messages.push(
    { id: `${id}-ask`, parts: [{ text: id, type: "text" }], role: "user" },
    {
      id,
      parts: parts.map(([files, kind], index) => ({
        data: { device: "mac", files, ...(kind && { kind }) },
        metadata: {
          createdAt: new Date(createdAt.getTime() + index),
          id: `${id}-${String(index)}`,
          messageId: id,
          sessionId,
        },
        type: "data-fileVersions",
      })),
      role: "assistant",
    },
  );
}

describe("undoReplyFiles", () => {
  it("puts back the file its reply handed over, never a namesake in another folder", async () => {
    const a = path.join(dir, "a", "index.html");
    const b = path.join(dir, "b", "index.html");
    turn("s-chat", "m1", [[[await kept(a, "A0")]]]);
    turn("s-chat", "m2", [[[await kept(a, "A1")]]]);
    turn("s-chat", "m3", [[[await kept(b, "B1")]]]);
    await undoReplyFiles({ chatId: "c" as never, messageId: "m2" as never });
    expect(await fs.readFile(a, "utf8")).toBe("A0");
    expect(await fs.readFile(b, "utf8")).toBe("B1");
  });

  it("puts back what the turn started from, even when an earlier turn kept those contents", async () => {
    const file = path.join(dir, "notes.md");
    turn("s-chat", "m1", [[[await kept(file, "A")]]]);
    turn("s-chat", "m2", [[[await kept(file, "B")]]]);
    const original = await kept(file, "A");
    turn("s-chat", "m3", [[[original], "original"], [[await kept(file, "C")]]]);
    await undoReplyFiles({ chatId: "c" as never, messageId: "m3" as never });
    expect(await fs.readFile(file, "utf8")).toBe("A");
  });

  it("undoes a task's reply from the task's own records", async () => {
    const file = path.join(dir, "report.md");
    turn("s-chat", "m1", [[[await kept(file, "first")]]]);
    turn("s-task", "t1", [[[await kept(file, "task")]]]);
    await undoReplyFiles({ chatId: "c" as never, messageId: "t1" as never });
    expect(await fs.readFile(file, "utf8")).toBe("first");
  });
});

describe("undoableReplies", () => {
  const undoable = async () =>
    (await undoableReplies({ chatId: "c" as never })).map((reply) => ({
      back: reply.back.map(({ file }) => path.relative(dir, file)),
      messageId: reply.messageId,
      stay: reply.stay,
    }));

  it("leaves out a reply that only made a new file", async () => {
    turn("s-chat", "m1", [[[await kept(path.join(dir, "sheet.png"), "new")]]]);
    expect(await undoable()).toEqual([]);
  });

  it("offers a reply that changed a file kept before it, naming what stays", async () => {
    const notes = path.join(dir, "notes.md");
    turn("s-chat", "m1", [[[await kept(notes, "A")]]]);
    turn("s-chat", "m2", [
      [[await kept(notes, "B"), await kept(path.join(dir, "new.md"), "N")]],
    ]);
    expect(await undoable()).toMatchInlineSnapshot(`
      [
        {
          "back": [
            "notes.md",
          ],
          "messageId": "m2",
          "stay": [
            "new.md",
          ],
        },
      ]
    `);
  });

  it("leaves out a reply whose file already holds what it was before", async () => {
    const notes = path.join(dir, "notes.md");
    turn("s-chat", "m1", [[[await kept(notes, "A")]]]);
    turn("s-chat", "m2", [[[await kept(notes, "B")]]]);
    await fs.writeFile(notes, "A");
    expect(await undoable()).toEqual([]);
  });

  it("leaves out a reply whose earlier copy was edited since it was kept", async () => {
    const notes = path.join(dir, "notes.md");
    const first = await kept(notes, "A");
    turn("s-chat", "m1", [[[first]]]);
    turn("s-chat", "m2", [[[await kept(notes, "B")]]]);
    await fs.writeFile(first.copy ?? "", "edited");
    expect(await undoable()).toEqual([]);
  });
});

describe("fileVersionHistory", () => {
  it("names the file a copy was kept of, not a namesake", async () => {
    const a = path.join(dir, "a", "index.html");
    const b = path.join(dir, "b", "index.html");
    const first = await kept(a, "A0");
    turn("s-chat", "m1", [[[first]]]);
    turn("s-chat", "m2", [[[await kept(b, "B1")]]]);
    const history = await fileVersionHistory({
      chatId: "c" as never,
      path: first.copy ?? "",
    });
    expect(history?.file).toBe(a);
  });

  it("offers no copy the trim has removed", async () => {
    const file = path.join(dir, "moon.svg");
    const first = await kept(file, "one");
    turn("s-chat", "m1", [[[first]]]);
    turn("s-chat", "m2", [[[await kept(file, "two")]]]);
    await fs.rm(first.copy ?? "");
    const history = await fileVersionHistory({
      chatId: "c" as never,
      path: file,
    });
    expect(history?.versions.map((version) => version.copy !== undefined))
      .toMatchInlineSnapshot(`
      [
        true,
        false,
      ]
    `);
  });
});

describe("restoreFileVersion", () => {
  it("refuses a copy of a namesake in another folder", async () => {
    const a = path.join(dir, "a", "index.html");
    const b = path.join(dir, "b", "index.html");
    const ofA = await kept(a, "A0");
    turn("s-chat", "m1", [[[ofA]]]);
    turn("s-chat", "m2", [[[await kept(b, "B1")]]]);
    await expect(
      restoreFileVersion({
        chatId: "c" as never,
        copy: ofA.copy ?? "",
        file: b,
      }),
    ).rejects.toThrow("not a version");
    expect(await fs.readFile(b, "utf8")).toBe("B1");
  });

  it("refuses a copy edited since it was kept", async () => {
    const file = path.join(dir, "notes.md");
    const first = await kept(file, "A");
    turn("s-chat", "m1", [[[first]]]);
    turn("s-chat", "m2", [[[await kept(file, "B")]]]);
    await fs.writeFile(first.copy ?? "", "edited");
    await expect(
      restoreFileVersion({
        chatId: "c" as never,
        copy: first.copy ?? "",
        file,
      }),
    ).rejects.toThrow("changed since it was kept");
    expect(await fs.readFile(file, "utf8")).toBe("B");
  });

  it("refuses to replace a file it can't keep a copy of first", async () => {
    const file = path.join(dir, "big.bin");
    const small = await kept(file, "small");
    turn("s-chat", "m1", [[[small]]]);
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    await fs.writeFile(file, big);
    await expect(
      restoreFileVersion({
        chatId: "c" as never,
        copy: small.copy ?? "",
        file,
      }),
    ).rejects.toThrow("wasn’t restored");
    expect((await fs.stat(file)).size).toBe(big.length);
  });
});
