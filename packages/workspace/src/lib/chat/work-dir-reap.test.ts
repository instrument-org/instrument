import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import {
  killSessionBackgroundProcesses,
  promoteBackgroundProcess,
  startBackgroundRun,
} from "../background-processes";
import { workDir } from "../work-dir";
import { reapWorkDir, startWorkDirReap } from "./work-dir-reap";

/** Chats with a session running, and chats being trashed. */
const running = new Set<ChatId>();
const trashing: ChatId[] = [];

// The workspace machine is more than a test builds; this stands in for the
// one part the reap reads, its snapshot of which chats run a session and
// which are being trashed, so it is a different type than the one it is
// passed as.
const workspaceRef = {
  getSnapshot: () => ({
    context: {
      chatsBeingTrashed: trashing,
      sessionRefsByChatId: new Map(
        [...running].map((chatId) => [
          chatId,
          [{ getSnapshot: () => ({ status: "active" }) }],
        ]),
      ),
    },
  }),
} as unknown as WorkspaceActorRef;

const sessions: StoreId.Session[] = [];

beforeAll(() => {
  startWorkDirReap(workspaceRef);
});

afterEach(async () => {
  running.clear();
  trashing.splice(0);
  await Promise.all(
    sessions.splice(0).map((id) => killSessionBackgroundProcesses(id)),
  );
});

/** A chat whose work folder its first command made, holding `entries`. */
function chatWith(entries: Record<string, string> = {}) {
  const sessionId = StoreId.newSessionId();
  sessions.push(sessionId);
  const chatId = chatFor(sessionId);
  const dir = workDir(chatId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(entries)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return { chatId, dir, sessionId };
}

describe("reapWorkDir", () => {
  it.each([
    ["an empty folder", true, {}],
    [
      "a folder holding only the Finder's view settings",
      true,
      { ".DS_Store": "" },
    ],
    ["a folder holding a file", false, { "notes.md": "x" }],
    [
      "a folder holding the Finder's view settings and a file",
      false,
      { ".DS_Store": "", "notes.md": "x" },
    ],
    ["a folder holding a folder", false, { "job/.keep": "" }],
  ])("%s, removed: %s", (_name, removed, entries) => {
    const { chatId, dir } = chatWith(entries);
    expect(reapWorkDir(chatId, workspaceRef)).toBe(removed);
    expect(fs.existsSync(dir)).toBe(!removed);
  });

  it("keeps an empty folder while a session of the chat runs, a task's included", () => {
    const { chatId, dir } = chatWith();
    running.add(chatId);
    expect(reapWorkDir(chatId, workspaceRef)).toBe(false);
    expect(fs.existsSync(dir)).toBe(true);
    running.delete(chatId);
    expect(reapWorkDir(chatId, workspaceRef)).toBe(true);
  });

  it("keeps an empty folder while a command the chat left running is still going", async () => {
    const { chatId, dir, sessionId } = chatWith();
    let finish: (result: { exitCode: number; output: string }) => void = () =>
      undefined;
    const handle = startBackgroundRun({
      callerSignal: new AbortController().signal,
      command: "sleep 60",
      run: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const promoted = promoteBackgroundProcess({ chatId, handle, sessionId });
    expect(promoted).toHaveProperty("info");
    // Its log folder, so the folder is as empty as one whose log could not
    // be opened.
    fs.rmSync(path.join(dir, ".tool-output"), { force: true, recursive: true });
    expect(reapWorkDir(chatId, workspaceRef)).toBe(false);
    expect(fs.existsSync(dir)).toBe(true);
    finish({ exitCode: 0, output: "" });
    await expect.poll(() => reapWorkDir(chatId, workspaceRef)).toBe(true);
  });

  it("leaves a chat being trashed to the trash", () => {
    const { chatId, dir } = chatWith();
    trashing.push(chatId);
    expect(reapWorkDir(chatId, workspaceRef)).toBe(false);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("does nothing for a chat whose folder is not there", () => {
    const { chatId, dir } = chatWith();
    fs.rmdirSync(dir);
    expect(reapWorkDir(chatId, workspaceRef)).toBe(false);
  });
});

describe("startWorkDirReap", () => {
  it("removes the chat's empty work folder when its turn ends", async () => {
    const { chatId, dir, sessionId } = chatWith();
    publisher.publish("session.done", { id: chatId, sessionId });
    await expect.poll(() => fs.existsSync(dir)).toBe(false);
  });

  it("keeps it when the turn ends with a task of the chat still at work", async () => {
    const kept = chatWith();
    const reaped = chatWith();
    running.add(kept.chatId);
    publisher.publish("session.done", {
      id: kept.chatId,
      sessionId: kept.sessionId,
    });
    // Ends after the first, and so is heard after it.
    publisher.publish("session.done", {
      id: reaped.chatId,
      sessionId: reaped.sessionId,
    });
    await expect.poll(() => fs.existsSync(reaped.dir)).toBe(false);
    expect(fs.existsSync(kept.dir)).toBe(true);
  });
});
