import { okAsync } from "neverthrow";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatReach } from "../permissions/chat-rules";
import { moveTopicFolders } from "../permissions/move-topic-folders";
import {
  permissionsFileIn,
  readPermissionSettings,
  reachOf,
} from "../permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  createTopic,
  listTopics,
  TOPIC_FILE_NAME,
  topicsDir,
  updateTopic,
} from "./topics";

// Which topic the chat is filed under, as its session says.
const filed = vi.hoisted(() => ({ topic: undefined as string | undefined }));

vi.mock(import("../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionOfChat: () => StoreId.newSessionId(),
}));
vi.mock(import("../chat-reads"), () => ({
  ChatReads: {
    session: () => okAsync({ topic: filed.topic } as never),
  } as never,
}));

const chatId = ChatIdSchema.parse("chat-topic-reach");
let root: string;
let machineDir: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "topic-reach-"));
  machineDir = fs.mkdtempSync(path.join(os.tmpdir(), "topic-reach-machine-"));
  // A folder of the person's, outside the workspace and the home folder,
  // which nothing but a grant opens to a change.
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "topic-reach-outside-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
  });
  filed.topic = undefined;
});

afterEach(() => {
  for (const dir of [root, machineDir, outside]) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

/** Writes a `folders:` key into a topic's file, as the agent could. */
function listInTopicFile(name: string, folder: string) {
  const file = path.join(topicsDir(), name, TOPIC_FILE_NAME);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(
    file,
    text.replace(/\n---\n/, `\nfolders:\n  - path: ${folder}\n---\n`),
  );
}

/** Leaves the permission settings a build before this one kept on this computer. */
function ranHereBefore() {
  fs.writeFileSync(permissionsFileIn(machineDir), "{}\n");
}

/** Whether the chat reaches `folder`, and what its rules say to a change in it. */
async function reachOfChat(folder: string) {
  const { folders, rules } = await chatReach(chatId);
  return {
    reached: Object.keys(folders).includes(folder),
    write: reachOf(rules, path.join(folder, "notes.md"), "write").level,
  };
}

describe("a topic's folders", () => {
  it("are reached from this computer's permission settings", async () => {
    const topic = await createTopic({ name: "Taxes" });
    filed.topic = topic.id;

    await updateTopic(topic.id, { folders: [{ path: outside }] });

    expect(await reachOfChat(outside)).toEqual({
      reached: true,
      write: "allow",
    });
    expect(
      fs.readFileSync(path.join(topicsDir(), "Taxes", TOPIC_FILE_NAME), "utf8"),
    ).not.toContain(outside);
    expect((await listTopics())[0]?.folders).toEqual([{ path: outside }]);
  });

  it("are never widened by a `folders:` key written into the topic's file", async () => {
    const topic = await createTopic({ name: "Taxes" });
    filed.topic = topic.id;
    moveTopicFolders({ machineDir, rootDir: root });

    listInTopicFile("Taxes", outside);

    expect(await reachOfChat(outside)).toEqual({
      reached: false,
      write: "ask",
    });
    // Nor by the launch after, which has moved what the file listed once.
    expect(moveTopicFolders({ machineDir, rootDir: root })).toEqual({
      moved: 0,
    });
    expect(await reachOfChat(outside)).toEqual({
      reached: false,
      write: "ask",
    });
  });
});

describe("moveTopicFolders", () => {
  it("takes what a topic's file listed onto this computer once, and out of the file", async () => {
    const topic = await createTopic({ name: "Taxes" });
    filed.topic = topic.id;
    listInTopicFile("Taxes", outside);
    ranHereBefore();

    expect(moveTopicFolders({ machineDir, rootDir: root })).toEqual({
      moved: 1,
    });

    expect((await readPermissionSettings()).topics).toEqual({
      [topic.id]: {
        folders: [{ addedAt: expect.any(Date), path: outside }],
      },
    });
    const file = fs.readFileSync(
      path.join(topicsDir(), "Taxes", TOPIC_FILE_NAME),
      "utf8",
    );
    expect(file).not.toContain("folders");
    expect(file).toContain(`id: ${topic.id}`);
    expect(await reachOfChat(outside)).toEqual({
      reached: true,
      write: "allow",
    });
  });

  it("keeps what this computer already granted, with the file's after it", async () => {
    const topic = await createTopic({ name: "Taxes" });
    const held = fs.mkdtempSync(path.join(outside, "held-"));
    await updateTopic(topic.id, { folders: [{ path: held }] });
    listInTopicFile("Taxes", outside);

    moveTopicFolders({ machineDir, rootDir: root });

    expect((await listTopics())[0]?.folders).toEqual([
      { path: held },
      { path: outside },
    ]);
  });

  it("takes in nothing on a computer opening the workspace for the first time", async () => {
    const topic = await createTopic({ name: "Taxes" });
    filed.topic = topic.id;
    listInTopicFile("Taxes", outside);

    expect(moveTopicFolders({ machineDir, rootDir: root })).toEqual({
      moved: 0,
    });

    expect((await readPermissionSettings()).topics).toEqual({});
    expect(await reachOfChat(outside)).toEqual({
      reached: false,
      write: "ask",
    });
    // The file is left for the computer that granted it, and no launch of
    // this one reads it after.
    expect(
      fs.readFileSync(path.join(topicsDir(), "Taxes", TOPIC_FILE_NAME), "utf8"),
    ).toContain(outside);
    expect(moveTopicFolders({ machineDir, rootDir: root })).toEqual({
      moved: 0,
    });
    expect(await reachOfChat(outside)).toEqual({
      reached: false,
      write: "ask",
    });
  });
});
