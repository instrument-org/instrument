import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { disposeSessionsStoreStorage } from "../../src/lib/session-store-storage";
import { Store } from "../../src/lib/store";
import { chatDir, sessionOfChat } from "../../src/lib/record-folders";
import { getChatState } from "../../src/lib/chat-record";
import { getChatSettings } from "../../src/lib/chat-settings";
import { ChatIdSchema, type ChatId } from "../../src/schemas/chat-id";
import { StoreId } from "../../src/schemas/store-id";
import { SubdomainPartSchema } from "../../src/schemas/subdomain-part";
import { type SeededTask, seedWorkspace } from "./seed-workspace";
import {
  listFixtureNames,
  loadWorkspaceFixture,
  type WorkspaceFixture,
} from "./workspace-fixture";

const opened: ChatId[] = [];

// Storage handles are cached by task id, and every case here seeds the same
// fixture into a new directory under the same ids. Without this, a read in one
// case leaves a handle open on its workspace that the next case would reuse.
afterEach(async () => {
  await Promise.all(opened.splice(0).map(disposeSessionsStoreStorage));
});

function at<T>(items: readonly T[], index: number): T {
  const item = items.at(index);
  if (item === undefined) {
    throw new Error(`No item at ${index} in a list of ${items.length}`);
  }
  return item;
}

/**
 * Reads what was seeded back the way the app does, not off the fixture: a
 * record's own sessions, or for a task a chat started, its session in the
 * chat's store.
 */
async function readSeededSession(seeded: SeededTask) {
  if (seeded.chat !== undefined) {
    const sessionId = StoreId.SessionSchema.parse(seeded.id);
    const loaded = await Store.getSessionWithMessagesAndParts(
      sessionId,
      seeded.chat,
    );
    return { session: loaded._unsafeUnwrap(), sessionIds: [sessionId] };
  }
  const taskId = ChatIdSchema.parse(seeded.id);
  const sessions = await Store.getSessions(taskId);
  const sessionIds = sessions._unsafeUnwrap().map((session) => session.id);
  const loaded = await Store.getSessionWithMessagesAndParts(
    at(sessionIds, 0),
    taskId,
  );
  return { session: loaded._unsafeUnwrap(), sessionIds };
}

async function seedInto(
  userDataDir: string,
  { fixtures = ["documents"], now }: { fixtures?: string[]; now?: Date } = {},
) {
  const loaded: WorkspaceFixture[] = [];
  const seeded = [];
  for (const name of fixtures) {
    const fixture = await loadWorkspaceFixture(name);
    loaded.push(fixture);
    const records = await seedWorkspace({ fixture, now, userDataDir });
    opened.push(...records.flatMap((record) => recordOf(record)));
    seeded.push(...records);
  }
  return { fixtures: loaded, seeded };
}

/** The record a seeded entry's store is in: its own, or its chat's. */
function recordOf(seeded: SeededTask): ChatId[] {
  return seeded.chat === undefined ? [ChatIdSchema.parse(seeded.id)] : [];
}

async function seedIntoTempDir(options?: { fixtures?: string[]; now?: Date }) {
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "instrument-seed-test-"),
  );
  const { fixtures, seeded } = await seedInto(userDataDir, options);
  const documents = at(fixtures, 0);
  const chat = at(documents.chats, 0);
  return { chat, chatTask: at(chat.tasks, 0), fixtures, seeded, userDataDir };
}

// Every committed fixture is parsed here rather than only the one the seed cases
// use. This is what turns a schema change into a failing check instead of a
// workspace that seeds and then cannot be opened.
describe("the committed corpus", () => {
  it("parses, with every chat and task carrying a transcript", async () => {
    const names = await listFixtureNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const fixture = await loadWorkspaceFixture(name);
      const sessions = [
        ...fixture.tasks.map(({ session }) => session),
        ...fixture.chats.flatMap(({ session, tasks }) => [
          session,
          ...tasks.map((task) => task.session),
        ]),
      ];
      expect(sessions.length).toBeGreaterThan(0);
      for (const session of sessions) {
        expect(session.messages.length).toBeGreaterThan(0);
      }
    }
  });

  it("names the fixtures it knows when asked for one it does not", async () => {
    await expect(loadWorkspaceFixture("no-such-fixture")).rejects.toThrow(
      /No fixture named "no-such-fixture"\. Available: /,
    );
  });
});

describe("seedWorkspace", () => {
  it("makes each chat a chat record and the tasks it started sessions in its store", async () => {
    const { chat, seeded } = await seedIntoTempDir();

    expect(seeded).toEqual([
      {
        id: chat.chat.key,
        key: chat.chat.key,
        kind: "chat",
        name: chat.chat.name,
      },
      ...chat.tasks.map(({ task }) => ({
        chat: chat.chat.key,
        id: expect.stringMatching(/^ses_/),
        key: task.key,
        kind: "task",
        name: task.name,
      })),
    ]);

    const chatId = ChatIdSchema.parse(at(seeded, 0).id);
    const chatSettings = await getChatSettings(chatDir(chatId));
    const { session } = await readSeededSession(at(seeded, 0));
    expect(chatSettings).toMatchObject({
      chatSessionId: session.id,
      name: chat.chat.name,
    });
    // Named by the manifest, so the app never renames it.
    expect(session.titleSettledAt).toBeDefined();

    for (const [index, task] of seeded.slice(1).entries()) {
      const { session: started } = await readSeededSession(task);
      expect(started).toMatchObject({
        handle: `t${index + 1}`,
        parentId: sessionOfChat(chatId),
        title: task.name,
      });
    }
    expect(await fs.readdir(chatDir(chatId))).not.toContain("tasks");
  });

  it("makes the chat's folders beside the workspace, granted to the chat", async () => {
    const { chat, seeded, userDataDir } = await seedIntoTempDir();

    const folder = at(chat.folders, 0);
    const made = path.join(userDataDir, "folders", folder.mount);
    for (const file of folder.files) {
      expect(await fs.readFile(path.join(made, file.to))).toEqual(
        await fs.readFile(file.from),
      );
    }

    const chatState = await getChatState(
      chatDir(ChatIdSchema.parse(at(seeded, 0).id)),
    );
    expect(chatState.attachedFolders?.[folder.mount]).toMatchObject({
      access: "read-write",
      mountName: folder.mount,
      path: made,
    });
  });

  it("seeds a task no chat owns as 1.x left it, with a pin as a raw settings key", async () => {
    const userDataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "instrument-seed-test-"),
    );
    const { fixtures, seeded } = await seedInto(userDataDir, {
      fixtures: ["legacy-tasks"],
    });
    const task = at(at(fixtures, 0).tasks, 0);

    expect(seeded).toEqual([
      {
        id: task.task.key,
        key: task.task.key,
        kind: "task",
        name: task.task.name,
      },
    ]);
    const settings = JSON.parse(
      await fs.readFile(
        path.join(
          userDataDir,
          "workspace",
          "tasks",
          at(seeded, 0).id,
          ".instrument",
          "settings.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(settings.parentTaskId).toBeUndefined();
    expect(typeof settings.pinnedAt).toBe("string");
  });

  // The caller clears the directory first; if it ever stops doing that, the
  // fallback naming inside `newChatId` would quietly hand the chat a dated
  // folder and the fixture's promised id would be a lie.
  it("refuses to seed on top of a workspace that already holds the chat", async () => {
    const { userDataDir } = await seedIntoTempDir();

    await expect(seedInto(userDataDir)).rejects.toThrow(
      /red-and-blue-squares already exists/,
    );
  });

  it("puts the app's stores beside the workspace, not inside it", async () => {
    const { userDataDir } = await seedIntoTempDir();

    const preferences = await fs.readFile(
      path.join(userDataDir, "preferences.json"),
      "utf8",
    );
    expect(JSON.parse(preferences)).toEqual({ developerMode: true });
    await expect(
      fs.access(path.join(userDataDir, "workspace", "chats")),
    ).resolves.toBeUndefined();
  });

  // Seeding several fixtures into one workspace runs writeSettings once per
  // fixture. Replacing the file each time would leave only the last one's keys.
  it("merges settings into a store another fixture already wrote", async () => {
    const { userDataDir } = await seedIntoTempDir();
    const legacy = await loadWorkspaceFixture("legacy-tasks");

    const second = {
      ...legacy,
      settings: { preferences: { theme: "dark" } },
      tasks: legacy.tasks.map((task) => ({
        ...task,
        task: {
          ...task.task,
          key: SubdomainPartSchema.parse("second-fixture-task"),
        },
      })),
    };
    const seeded = await seedWorkspace({ fixture: second, userDataDir });
    opened.push(...seeded.flatMap((task) => recordOf(task)));

    expect(
      JSON.parse(
        await fs.readFile(path.join(userDataDir, "preferences.json"), "utf8"),
      ),
    ).toEqual({ developerMode: true, theme: "dark" });
  });

  it("copies the task's files to the paths it declares, in its chat's folder", async () => {
    const { chatTask, seeded } = await seedIntoTempDir();
    const filedIn = at(seeded, 1).chat;
    if (!filedIn) {
      throw new Error("the task was seeded in no chat");
    }
    const dir = chatDir(filedIn);

    expect(chatTask.files.length).toBeGreaterThan(0);
    for (const file of chatTask.files) {
      expect(await fs.readFile(path.join(dir, file.to))).toEqual(
        await fs.readFile(file.from),
      );
    }
  });

  it("stores each transcript so the app's own reader can load it", async () => {
    const { chat, seeded } = await seedIntoTempDir();

    for (const [index, recorded] of [
      chat.session,
      ...chat.tasks.map((task) => task.session),
    ].entries()) {
      const { session, sessionIds } = await readSeededSession(
        at(seeded, index),
      );
      expect(sessionIds).toHaveLength(1);
      expect(session.messages.map((message) => message.role)).toEqual(
        recorded.messages.map((message) => message.role),
      );
      // The manifest is where a fixture says what it is, so its name wins over
      // whatever the run that produced the transcript was called.
      expect(session.title).toBe(at(seeded, index).name);
    }
  });

  it("mints new ids rather than reusing the recorded ones", async () => {
    const { chatTask, seeded } = await seedIntoTempDir();

    const { session, sessionIds } = await readSeededSession(at(seeded, 1));
    expect(at(sessionIds, 0)).not.toBe(chatTask.session.id);

    const recordedMessageIds = new Set(
      chatTask.session.messages.map((message) => message.id),
    );
    for (const message of session.messages) {
      expect(recordedMessageIds.has(message.id)).toBe(false);
      expect(message.metadata.sessionId).toBe(session.id);
      for (const part of message.parts) {
        expect(part.metadata.messageId).toBe(message.id);
      }
    }
  });

  it("anchors the transcript to seed time, keeping the recorded spacing", async () => {
    const now = new Date("2026-03-04T05:06:07.000Z");
    const { chatTask, seeded } = await seedIntoTempDir({ now });

    const { session } = await readSeededSession(at(seeded, 1));

    // Every recorded instant counts, a reply's finish included, as it does
    // for the seeder.
    const dates = (metadata: object) =>
      Object.values(metadata).flatMap((value) =>
        value instanceof Date ? [value.getTime()] : [],
      );
    const latest = Math.max(
      ...session.messages.flatMap((message) => [
        ...dates(message.metadata),
        ...message.parts.flatMap((part) => dates(part.metadata)),
      ]),
    );
    expect(latest).toBe(now.getTime() - chatTask.task.agedMinutes * 60_000);

    const span = (messages: { metadata: { createdAt: Date } }[]) =>
      at(messages, -1).metadata.createdAt.getTime() -
      at(messages, 0).metadata.createdAt.getTime();
    expect(span(session.messages)).toBe(span(chatTask.session.messages));
  });
});
