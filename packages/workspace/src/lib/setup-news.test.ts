import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  APPS_FOLDER_NAME,
  MEMORY_FOLDER_NAME,
  SKILLS_FOLDER_NAME,
  TOPIC_FILE_NAME,
  TOPICS_FOLDER_NAME,
} from "../constants";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";
import { withTestRecords } from "../test/helpers/with-test-records";
import { APP_FILE_NAME } from "./apps/app-file";
import { createSession } from "./create-session";
import { forgetChatFolders } from "./record-folders";
import { createSetupNewsPart, recordSetupTold } from "./setup-news";
import { setupTouchesBetween, snapshotSetup } from "./setup-snapshot";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

withTestRecords();

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "setup-news-")),
  );
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(rootDir, "chats")),
    rootDir: WorkspaceDirSchema.parse(rootDir),
  });
  forgetChatFolders();
});

afterEach(async () => {
  forgetChatFolders();
  await removeChatsDir(rootDir);
  await fs.rm(rootDir, { force: true, recursive: true });
});

async function write(relative: string, text = "x\n") {
  const file = path.join(rootDir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

const skill = (name: string, file = "SKILL.md") =>
  path.join(SKILLS_FOLDER_NAME, name, file);

describe("setupTouchesBetween", () => {
  it("names each item added, changed or removed, by whether it was there", async () => {
    await write(skill("tidy"));
    await write(skill("stale"));
    await write(path.join(MEMORY_FOLDER_NAME, "mornings.md"));
    await write(path.join(TOPICS_FOLDER_NAME, "Travel", TOPIC_FILE_NAME));
    const before = await snapshotSetup();

    await write(skill("tidy", "run.sh"));
    await fs.rm(path.join(rootDir, SKILLS_FOLDER_NAME, "stale"), {
      recursive: true,
    });
    await write(path.join(APPS_FOLDER_NAME, "Linear", APP_FILE_NAME));
    await write(path.join(MEMORY_FOLDER_NAME, "mornings.md"), "Later.\n");
    // A folder with no TOPIC.md is not a topic, so writing in one is no news.
    await write(path.join(TOPICS_FOLDER_NAME, "Loose", "notes.md"));

    expect(
      setupTouchesBetween(before, await snapshotSetup()).toSorted((a, b) =>
        a.name.localeCompare(b.name),
      ),
    ).toEqual([
      { existedBefore: false, kind: "app", name: "Linear" },
      { existedBefore: true, kind: "memory", name: "mornings" },
      { existedBefore: true, kind: "skill", name: "stale" },
      { existedBefore: true, kind: "skill", name: "tidy" },
    ]);
  });

  it("skips what an install or a build leaves in an item", async () => {
    await write(skill("web"));
    const before = await snapshotSetup();

    await write(skill("web", "node_modules/left-pad/index.js"));
    await write(skill("web", ".venv/bin/python"));
    await write(skill("web", ".git/HEAD"));

    expect(setupTouchesBetween(before, await snapshotSetup())).toEqual([]);
  });
});

describe("createSetupNewsPart", () => {
  async function session() {
    const sessionId = StoreId.newSessionId();
    const chatId = await chatFor(sessionId);
    (await createSession({ chatId, sessionId }))._unsafeUnwrap();
    const next = async () => {
      const part = await createSetupNewsPart({
        chatId,
        createdAt: new Date(),
        messageId: StoreId.newMessageId(),
        sessionId,
      });
      return part?.type === "data-setupNews" ? part.data : undefined;
    };
    return { chatId, next, sessionId };
  }

  it("says nothing on a session's first message, then what came or changed since", async () => {
    await write(skill("tidy"));
    await write(skill("stale"));
    const { next } = await session();

    await expect(next()).resolves.toBeUndefined();
    await write(skill("tidy", "run.sh"));
    await fs.rm(path.join(rootDir, SKILLS_FOLDER_NAME, "stale"), {
      recursive: true,
    });
    await write(path.join(APPS_FOLDER_NAME, "Linear", APP_FILE_NAME));
    // Memories have news of their own.
    await write(path.join(MEMORY_FOLDER_NAME, "mornings.md"));

    // Apps and memories have news of their own.
    await expect(next()).resolves.toEqual({
      changes: [
        { change: "changed", kind: "skill", name: "tidy" },
      ],
    });
    await expect(next()).resolves.toBeUndefined();
  });

  it("does not repeat what the session's own turn changed", async () => {
    await write(skill("tidy"));
    const { chatId, next, sessionId } = await session();
    await next();

    await write(skill("tidy", "run.sh"));
    await write(skill("brief"));
    await recordSetupTold({
      changes: [{ change: "changed", kind: "skill", name: "tidy" }],
      chatId,
      sessionId,
    });

    await expect(next()).resolves.toEqual({
      changes: [{ change: "added", kind: "skill", name: "brief" }],
    });
  });
});
