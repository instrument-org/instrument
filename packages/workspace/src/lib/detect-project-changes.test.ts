import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../constants";
import { AbsolutePathSchema } from "../schemas/paths";
import { type ProjectId } from "../schemas/project-id";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { createSession } from "./create-session";
import { detectProjectChanges } from "./detect-project-changes";
import { createProject } from "./project";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";
import { getTaskState } from "./task-record";
import { updateTaskSettings } from "./task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const id = TaskIdSchema.parse("detect-project-changes-test");
const sessionId = StoreId.newSessionId();

let notesDir: string;
let root: string;
let taskId: TaskId;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "detect-project-changes-"));
  notesDir = path.join(root, "Notes");
  await fs.mkdir(notesDir);
  taskId = createMockTaskConfigForDir(path.join(root, TASKS_DIR_NAME, id));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    projectsDir: AbsolutePathSchema.parse(path.join(root, PROJECTS_DIR_NAME)),
  });
  await fs.mkdir(taskDir(taskId), { recursive: true });
  await fs.mkdir(path.join(root, PROJECTS_DIR_NAME), { recursive: true });

  const session = await createSession({ sessionId, taskId });
  if (session.isErr()) {
    throw session.error;
  }
  // One message on the record, since the first message of a session has
  // nothing behind it to diff against and is skipped.
  const messageId = StoreId.newMessageId();
  const saved = await Store.saveMessageWithParts(
    {
      id: messageId,
      metadata: { createdAt: new Date(), sessionId },
      parts: [],
      role: "user",
    },
    taskId,
  );
  if (saved.isErr()) {
    throw saved.error;
  }
});

afterEach(async () => {
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

async function attachedFolders() {
  const state = await getTaskState(taskDir(taskId));
  return Object.values(state.attachedFolders ?? {}).map((folder) => ({
    access: folder.access,
    path: folder.path,
    source: folder.source,
  }));
}

async function projectWithNotes(): Promise<ProjectId> {
  const project = await createProject({
    folders: [{ access: "read-only", path: notesDir }],
    name: "Reports",
  });
  if (project.isErr()) {
    throw project.error;
  }
  return project.value.id;
}

async function run() {
  const result = await detectProjectChanges({
    messageId: StoreId.newMessageId(),
    sessionId,
    taskId,
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

describe("detectProjectChanges", () => {
  // Membership is the task's settings. A task moved into a project after it was
  // created carries no project snapshot in its transcript, and reading
  // membership from that snapshot left it with none of the project's folders.
  it("takes on the folders of a project the task was moved into", async () => {
    const projectId = await projectWithNotes();
    const updated = await updateTaskSettings(taskId, { projectId });
    if (updated.isErr()) {
      throw updated.error;
    }

    await run();

    expect(await attachedFolders()).toEqual([
      { access: "read-only", path: notesDir, source: "project" },
    ]);
  });

  // ...and one moved out keeps what it has without tracking the project it
  // left, which its snapshot would otherwise go on naming forever.
  it("leaves a task that belongs to no project alone", async () => {
    const projectId = await projectWithNotes();
    const joined = await updateTaskSettings(taskId, { projectId });
    if (joined.isErr()) {
      throw joined.error;
    }
    await run();

    const left = await updateTaskSettings(taskId, { projectId: null });
    if (left.isErr()) {
      throw left.error;
    }

    expect(await run()).toBeUndefined();
    expect(await attachedFolders()).toEqual([
      { access: "read-only", path: notesDir, source: "project" },
    ]);
  });

  it("records what the project said, for the next message to compare", async () => {
    const projectId = await projectWithNotes();
    const updated = await updateTaskSettings(taskId, { projectId });
    if (updated.isErr()) {
      throw updated.error;
    }

    await run();

    const state = await getTaskState(taskDir(taskId));
    expect(state.projectFolderBaseline).toEqual({ [notesDir]: "read-only" });
  });
});
