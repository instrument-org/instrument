import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { beginTurnFileVersions, takeOriginals } from "./chat/turn-originals";
import { createBashEnv } from "./create-bash-env";
import { withTurnContext } from "./turn-context";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";

/**
 * What the shell's own commands replace, kept for the turn's Undo by the
 * filesystem they write through (`original-keeping-fs.ts`).
 */
let tmpDir: string;
/** A folder the person granted the chat, where its writes keep originals. */
let docs: string;
let chatId: ChatId;
let notes: string;
let sessionId: StoreId.Session;

async function run(command: string) {
  const turn = { id: chatId, sessionId };
  const bash = await createBashEnv({
    chatId,
    folders: {
      docs: {
        access: "read-write",
        id: MountedFolder.IdSchema.parse("docs"),
        path: AbsolutePathSchema.parse(docs),
      },
    },
    sessionId,
  });
  const result = await withTurnContext(turn, () =>
    bash.exec(command, { signal: AbortSignal.timeout(30_000) }),
  );
  expect(result.stderr).toBe("");
}

/** Each original the turn kept, by its file's name, with what its copy holds. */
async function kept() {
  return Promise.all(
    takeOriginals(sessionId).map(async ({ copy, path: name }) => [
      name,
      await fs.readFile(copy ?? "", "utf8"),
    ]),
  );
}

beforeAll(async () => {
  tmpDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bash-originals-")),
  );
  const chatRoot = path.join(tmpDir, "chats", "originals");
  docs = path.join(tmpDir, "docs");
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.mkdir(docs);
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chatRoot));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(tmpDir),
  });
  notes = shellPath(path.join(docs, "notes.md"));
});

beforeEach(async () => {
  sessionId = StoreId.newSessionId();
  await fs.writeFile(path.join(docs, "notes.md"), "first\n");
});

afterAll(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("originals the shell's commands keep", () => {
  it("keeps what sed -i and >> replace, once per file", async () => {
    beginTurnFileVersions(sessionId);
    await run(`sed -i 's/first/second/' ${notes} && echo third >> ${notes}`);
    await expect(kept()).resolves.toEqual([["notes.md", "first\n"]]);
    await expect(
      fs.readFile(path.join(docs, "notes.md"), "utf8"),
    ).resolves.toBe("second\nthird\n");
  });

  it("keeps nothing for a file the turn made, or one in the work folder", async () => {
    beginTurnFileVersions(sessionId);
    await fs.mkdir(workDir(chatId), { recursive: true });
    await fs.writeFile(path.join(workDir(chatId), "draft.md"), "draft\n");
    const fresh = shellPath(path.join(docs, "new.md"));
    await run(`echo new > ${fresh} && echo over > draft.md`);
    // A later command of the same turn, so its shell has never seen the file.
    await run(`echo more >> ${fresh}`);
    await expect(kept()).resolves.toEqual([]);
  });

  it("stops at a turn's most originals", async () => {
    const many = path.join(docs, "many");
    await fs.mkdir(many, { recursive: true });
    await Promise.all(
      Array.from({ length: 102 }, (_, index) =>
        fs.writeFile(
          path.join(many, `${String(index)}.md`),
          `${String(index)}\n`,
        ),
      ),
    );
    beginTurnFileVersions(sessionId);
    await run(`for f in ${shellPath(many)}/*.md; do echo over > "$f"; done`);
    expect(takeOriginals(sessionId)).toHaveLength(100);
  });

  it("keeps nothing outside a turn", async () => {
    await run(`echo over > ${notes}`);
    await expect(kept()).resolves.toEqual([]);
  });
});
