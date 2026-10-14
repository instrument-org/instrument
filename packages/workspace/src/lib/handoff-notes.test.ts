import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import {
  agentHandoffNotesPath,
  contextRolloverNotice,
  readHandoffNotes,
} from "./handoff-notes";
import { chatDir } from "./record-folders";
import { sanitizeSurrogates } from "./sanitize-model-text";

const NOTES_PATH = "/workspace/chats/c/handoff-notes.md";

describe("contextRolloverNotice", () => {
  it("puts the notes in the request rather than pointing at them", () => {
    const notice = contextRolloverNotice(
      "Format: the number, a period, then the English word.",
      NOTES_PATH,
    );

    expect(notice).toContain(
      "Format: the number, a period, then the English word.",
    );
    // The version this replaces asked the agent to go and read the file, which
    // costs a tool call it did not spend. Nothing here asks for one.
    expect(notice).not.toMatch(/read (your |the )?notes there/i);
  });

  it("says what is missing, whether or not there are notes", () => {
    for (const notice of [
      contextRolloverNotice("some notes", NOTES_PATH),
      contextRolloverNotice(undefined, NOTES_PATH),
    ]) {
      expect(notice).toContain("continued in a fresh window");
      expect(notice).toContain("Your own earlier turns have not");
    }
  });

  it("names the same path it would be read from when there are none", () => {
    expect(contextRolloverNotice(undefined, NOTES_PATH)).toContain(NOTES_PATH);
  });

  // Older user messages past the retention budget are dropped whole and a cut
  // one carries an omission marker, so a notice promising the user's words in
  // full would hand the model a contradiction to reason from.
  it("does not promise the user's words survived in full", () => {
    for (const notice of [
      contextRolloverNotice("some notes", NOTES_PATH),
      contextRolloverNotice(undefined, NOTES_PATH),
    ]) {
      expect(notice).not.toMatch(/in full/i);
      expect(notice).toContain("size budget");
      expect(notice).toContain("[context rollover omitted");
    }
  });
});

describe("readHandoffNotes", () => {
  let tasksParentDir: string;

  beforeEach(async () => {
    tasksParentDir = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-notes-"));
  });

  afterEach(async () => {
    await fs.rm(tasksParentDir, { force: true, recursive: true });
  });

  // The write instruction and the read both derive from this, so a path that
  // drifted would break the handoff silently rather than loudly.
  it("names the notes in the chat's record folder", async () => {
    const dir = path.join(tasksParentDir, "task-1");
    await fs.mkdir(dir, { recursive: true });
    const chatId = createMockChatConfigForDir(dir);

    expect(agentHandoffNotesPath(chatId)).toBe(
      path.join(chatDir(chatId), "handoff-notes.md"),
    );
  });

  it("truncates without leaving half a character behind", async () => {
    const dir = path.join(tasksParentDir, "task-1");
    await fs.mkdir(dir, { recursive: true });
    // 7,999 plain characters land the truncation index between the two halves
    // of the emoji, which is where a fixed-index slice makes a lone surrogate.
    await fs.writeFile(
      path.join(dir, "handoff-notes.md"),
      `${"x".repeat(7999)}🙈${"y".repeat(100)}`,
    );
    const chatId = createMockChatConfigForDir(dir);

    const notes = await readHandoffNotes(chatId);

    expect(notes).toBeDefined();
    expect(notes).toContain("[Notes truncated");
    expect(sanitizeSurrogates(notes ?? "")).toBe(notes);
  });

  // The notes sit beside the chat's settings, and the agent writes them: a
  // link it made there must not hand the settings to the model, and nothing
  // it put there may hold the request up.
  it.each([
    [
      "a file",
      async (notes: string) => {
        await fs.writeFile(notes, "Left off at step 3.");
      },
      "Left off at step 3.",
    ],
    [
      "a link to the settings",
      async (notes: string) => {
        await fs.symlink(
          path.join(path.dirname(notes), "settings.json"),
          notes,
        );
      },
      undefined,
    ],
    [
      "a link to a link to the settings",
      async (notes: string) => {
        const between = path.join(path.dirname(notes), "between");
        await fs.symlink(
          path.join(path.dirname(notes), "settings.json"),
          between,
        );
        await fs.symlink(between, notes);
      },
      undefined,
    ],
    [
      "a folder",
      async (notes: string) => {
        await fs.mkdir(notes);
      },
      undefined,
    ],
    [
      "a pipe nothing writes to",
      async (notes: string) => {
        // Windows keeps no pipe at a path, and nothing there reads the same.
        if (process.platform !== "win32") {
          await execa("mkfifo", [notes]);
        }
      },
      undefined,
    ],
  ])("reads %s", async (_case, put, expected) => {
    const dir = path.join(tasksParentDir, "task-1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "settings.json"), '{"grants":[]}');
    await put(path.join(dir, "handoff-notes.md"));
    const chatId = createMockChatConfigForDir(dir);

    expect(await readHandoffNotes(chatId)).toBe(expected);
  });

  // A file that is swapped for a link once it was looked at is read as the
  // file it was, never through the link.
  it("reads nothing through a link put there after a look", async () => {
    const dir = path.join(tasksParentDir, "task-1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "settings.json"), '{"grants":[]}');
    const notes = path.join(dir, "handoff-notes.md");
    await fs.writeFile(notes, "Left off at step 3.");
    const chatId = createMockChatConfigForDir(dir);
    const look = fs.lstat.bind(fs);
    const lstat = vi
      .spyOn(fs, "lstat")
      .mockImplementationOnce(async (...args: Parameters<typeof fs.lstat>) => {
        const seen = await look(...args);
        await fs.rm(notes);
        await fs.symlink(path.join(dir, "settings.json"), notes);
        return seen;
      });

    try {
      expect(await readHandoffNotes(chatId)).toBe("Left off at step 3.");
    } finally {
      lstat.mockRestore();
    }
  });
});
