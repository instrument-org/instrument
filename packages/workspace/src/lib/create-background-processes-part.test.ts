import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import {
  killSessionBackgroundProcesses,
  promoteBackgroundProcess,
  startBackgroundRun,
} from "./background-processes";
import { createBackgroundProcessesPart } from "./create-background-processes-part";
import { disposeSessionsStoreStorage } from "./session-store-storage";
import { taskDir } from "./task-dir-utils";

const id = TaskIdSchema.parse("background-processes-part-test");

let root: string;
let sessionId: StoreId.Session;
let taskId: TaskId;

async function makePart() {
  return createBackgroundProcessesPart({
    createdAt: new Date(),
    messageId: StoreId.newMessageId(),
    sessionId,
    taskId,
  });
}

/**
 * A run that never finishes on its own but does settle when stopped, which is
 * what a real killed subprocess does: execa rejects once the child is gone.
 */
function startRunning(command: string) {
  const handle = startBackgroundRun({
    callerSignal: new AbortController().signal,
    command,
    run: ({ signal }) =>
      new Promise<{ exitCode: number; output: string }>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
    taskId,
  });
  const promoted = promoteBackgroundProcess({ handle, sessionId, taskId });
  if ("error" in promoted) {
    throw new Error(promoted.error);
  }
  return promoted.info;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bg-part-test-"));
  taskId = createMockTaskConfigForDir(path.join(root, TASKS_DIR_NAME, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
  sessionId = StoreId.newSessionId();
});

afterEach(async () => {
  await killSessionBackgroundProcesses(sessionId);
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

describe("createBackgroundProcessesPart", () => {
  it("says nothing when the session has never had one", async () => {
    expect(await makePart()).toBeUndefined();
  });

  it("names what is running the first time it is asked", async () => {
    const info = startRunning("node work/server.js");

    const part = await makePart();
    expect(part?.type).toBe("data-backgroundProcesses");
    if (part?.type !== "data-backgroundProcesses") {
      throw new Error("expected a background processes part");
    }
    expect(part.data.running.map(({ id: runningId }) => runningId)).toEqual([
      info.id,
    ]);
    expect(part.data.ended).toEqual([]);
  });

  it("stays quiet on a later turn when the same set is still running", async () => {
    startRunning("node work/server.js");
    await makePart();

    // Durations move on their own, and restating them every turn would spend
    // context on something the agent has no reason to doubt.
    expect(await makePart()).toBeUndefined();
  });

  it("reports what went away, which is what a restart looks like", async () => {
    const info = startRunning("node work/server.js");
    await makePart();

    // Whatever ended it -- a kill, a quit, the age cap -- the session was last
    // told this was running, and that is now false.
    await killSessionBackgroundProcesses(sessionId);

    const part = await makePart();
    if (part?.type !== "data-backgroundProcesses") {
      throw new Error("expected a background processes part");
    }
    expect(part.data.running).toEqual([]);
    expect(part.data.ended.map(({ id: endedId }) => endedId)).toEqual([
      info.id,
    ]);
  });

  it("stops mentioning a process once its ending has been reported", async () => {
    startRunning("node work/server.js");
    await makePart();
    await killSessionBackgroundProcesses(sessionId);
    await makePart();

    expect(await makePart()).toBeUndefined();
  });
});
