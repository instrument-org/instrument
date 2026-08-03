import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { disposeSessionsStoreStorage } from "../../src/lib/session-store-storage";
import { Store } from "../../src/lib/store";
import { taskDir } from "../../src/lib/task-dir-utils";
import { getTaskSettings } from "../../src/lib/task-settings";
import { type TaskId } from "../../src/schemas/task-id";
import { seedWorkspace } from "./seed-workspace";
import { listFixtureNames, loadWorkspaceFixture } from "./workspace-fixture";

const FIXTURE = "documents";

const opened: TaskId[] = [];

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

/** Reads a seeded task back the way the app does, not off the fixture. */
async function readSeededSession(taskId: TaskId) {
  const storeIds = await Store.getStoreId(taskId);
  const sessionIds = storeIds._unsafeUnwrap();
  const loaded = await Store.getSessionWithMessagesAndParts(
    at(sessionIds, 0),
    taskId,
  );
  return { session: loaded._unsafeUnwrap(), sessionIds };
}

async function seedInto(userDataDir: string, now?: Date) {
  const fixture = await loadWorkspaceFixture(FIXTURE);
  const tasks = await seedWorkspace({ fixture, now, userDataDir });
  opened.push(...tasks.map((task) => task.id));
  return { fixture, tasks };
}

async function seedIntoTempDir(now?: Date) {
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "instrument-seed-test-"),
  );
  const { fixture, tasks } = await seedInto(userDataDir, now);
  return { first: at(fixture.tasks, 0), fixture, tasks, userDataDir };
}

// Every committed fixture is parsed here rather than only the one the seed cases
// use. This is what turns a schema change into a failing check instead of a
// workspace that seeds and then cannot be opened.
describe("the committed corpus", () => {
  it("parses, with every task carrying a transcript", async () => {
    const names = await listFixtureNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const fixture = await loadWorkspaceFixture(name);
      expect(fixture.tasks.length).toBeGreaterThan(0);
      for (const { session } of fixture.tasks) {
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
  it("creates a task per fixture task, named by the manifest", async () => {
    const { fixture, tasks } = await seedIntoTempDir();

    expect(tasks.map((task) => task.id)).toEqual(
      fixture.tasks.map(({ task }) => task.key),
    );

    for (const seeded of tasks) {
      const settings = await getTaskSettings(taskDir(seeded.id));
      expect(settings?.name).toBe(seeded.name);
    }
  });

  // The caller clears the directory first; if it ever stops doing that, the
  // fallback naming inside `newTaskId` would quietly hand the task a dated
  // folder and the fixture's promised id would be a lie.
  it("refuses to seed on top of a workspace that already holds the task", async () => {
    const { userDataDir } = await seedIntoTempDir();

    await expect(seedInto(userDataDir)).rejects.toThrow(
      /tasks\/generated-pdf already exists/,
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
      fs.access(path.join(userDataDir, "workspace", "tasks")),
    ).resolves.toBeUndefined();
  });

  it("copies the fixture's input files to the paths it declares", async () => {
    const { fixture, tasks } = await seedIntoTempDir();

    for (const [index, { files }] of fixture.tasks.entries()) {
      for (const file of files) {
        const seeded = path.join(taskDir(at(tasks, index).id), file.to);
        expect(await fs.readFile(seeded)).toEqual(await fs.readFile(file.from));
      }
    }
  });

  it("stores the transcript so the app's own reader can load it", async () => {
    const { first, tasks } = await seedIntoTempDir();

    const { session, sessionIds } = await readSeededSession(at(tasks, 0).id);
    expect(sessionIds).toHaveLength(1);

    expect(session.messages).toHaveLength(first.session.messages.length);
    expect(session.messages.map((message) => message.role)).toEqual(
      first.session.messages.map((message) => message.role),
    );
    // The manifest is where a fixture says what it is, so the task's name wins
    // over whatever the run that produced the transcript was called.
    expect(session.title).toBe(first.task.name);
  });

  it("mints new ids rather than reusing the recorded ones", async () => {
    const { first, tasks } = await seedIntoTempDir();

    const { session, sessionIds } = await readSeededSession(at(tasks, 0).id);
    expect(at(sessionIds, 0)).not.toBe(first.session.id);

    const recordedMessageIds = new Set(
      first.session.messages.map((message) => message.id),
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
    const { first, tasks } = await seedIntoTempDir(now);

    const { session } = await readSeededSession(at(tasks, 0).id);

    const latest = Math.max(
      ...session.messages.flatMap((message) => [
        message.metadata.createdAt.getTime(),
        ...message.parts.map((part) => part.metadata.createdAt.getTime()),
      ]),
    );
    expect(latest).toBe(now.getTime() - first.task.agedMinutes * 60_000);

    const span = (messages: { metadata: { createdAt: Date } }[]) =>
      at(messages, -1).metadata.createdAt.getTime() -
      at(messages, 0).metadata.createdAt.getTime();
    expect(span(session.messages)).toBe(span(first.session.messages));
  });
});
