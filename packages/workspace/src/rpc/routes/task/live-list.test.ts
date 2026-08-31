import { call } from "@orpc/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sleep } from "radashi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../../../constants";
import { updateTaskSettings } from "../../../lib/task-settings";
import { getWorkspaceConfig } from "../../../lib/workspace-config";
import { type TaskId, TaskIdSchema } from "../../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../../test/helpers/mock-task-config";
import { type WorkspaceRPCContext } from "../../base";
import { publisher } from "../../publisher";
import { task } from "./index";

// Counts full workspace scans. `getTasks` globs every task directory and reads
// every record file, so one call is one scan, and the subscription is supposed
// to answer an event with a single-task read instead.
const { scans } = vi.hoisted(() => ({ scans: { count: 0 } }));

vi.mock(import("../../../lib/get-tasks"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getTasks: (...args: Parameters<typeof actual.getTasks>) => {
      scans.count++;
      return actual.getTasks(...args);
    },
  };
});

const LIST_INPUT = { direction: "desc", sortBy: "updatedAt" } as const;

let controller: AbortController;
let root: string;
let tasksDir: string;

let alpha: TaskId;
let beta: TaskId;
let gamma: TaskId;

function context(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // The list routes never read the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

function freshList() {
  return call(task.list, LIST_INPUT, { context: context() });
}

async function liveList() {
  const iterator = await call(task.live.list, LIST_INPUT, {
    context: context(),
    signal: controller.signal,
  });
  return { first: yielded(await iterator.next()), iterator };
}

// Pulls the next yield around `change`, which is what wakes the subscription.
// The pull starts first so the subscription is listening before the event is
// published.
async function nextAfter(
  iterator: Awaited<ReturnType<typeof liveList>>["iterator"],
  change: () => Promise<void> | void,
) {
  const pending = iterator.next();
  await sleep(20);
  await change();
  return yielded(await pending);
}

async function seedTask(id: string, day: number) {
  const taskId = TaskIdSchema.parse(id);
  await fs.mkdir(path.join(tasksDir, id), { recursive: true });
  // Both stamps are written so neither ordering falls back to the folder's
  // filesystem timestamps, which three tasks made in the same millisecond
  // cannot be told apart by.
  const result = await updateTaskSettings(taskId, {
    createdAt: new Date(`2026-01-0${day}T00:00:00.000Z`),
    lastActivityAt: new Date(`2026-02-0${day}T00:00:00.000Z`),
    name: id,
  });
  expect(result.isOk()).toBe(true);
  return taskId;
}

function titles(list: { tasks: { title: string }[] }) {
  return list.tasks.map((entry) => entry.title);
}

function yielded<T>(result: IteratorResult<T, unknown>): T {
  if (result.done) {
    throw new Error("The subscription ended before it yielded");
  }
  return result.value;
}

beforeEach(async () => {
  scans.count = 0;
  controller = new AbortController();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "live-task-list-"));
  tasksDir = path.join(root, TASKS_DIR_NAME);
  await fs.mkdir(tasksDir, { recursive: true });
  createMockTaskConfigForDir(path.join(tasksDir, "alpha"));

  alpha = await seedTask("alpha", 1);
  beta = await seedTask("beta", 2);
  gamma = await seedTask("gamma", 3);
});

afterEach(async () => {
  controller.abort();
  await fs.rm(root, { force: true, recursive: true });
});

describe("workspace.task.live.list", () => {
  it("patches an updated task in without rescanning the workspace", async () => {
    const { first, iterator } = await liveList();
    expect(titles(first)).toEqual(["gamma", "beta", "alpha"]);
    expect(scans.count).toBe(1);

    const updated = await nextAfter(iterator, async () => {
      const result = await updateTaskSettings(alpha, {
        lastActivityAt: new Date("2026-02-04T00:00:00.000Z"),
        name: "alpha renamed",
      });
      expect(result.isOk()).toBe(true);
    });

    expect(scans.count).toBe(1);
    expect(titles(updated)).toEqual(["alpha renamed", "gamma", "beta"]);
    expect(updated).toEqual(await freshList());
  });

  it("drops a removed task", async () => {
    const { iterator } = await liveList();

    const afterRemoval = await nextAfter(iterator, async () => {
      await fs.rm(path.join(tasksDir, gamma), { force: true, recursive: true });
      publisher.publish("task.removed", { id: gamma });
    });

    expect(scans.count).toBe(1);
    expect(titles(afterRemoval)).toEqual(["beta", "alpha"]);
    expect(afterRemoval).toEqual(await freshList());
  });

  it("adds a task the snapshot has never seen", async () => {
    const { iterator } = await liveList();

    const afterCreate = await nextAfter(iterator, async () => {
      await seedTask("delta", 4);
    });

    expect(scans.count).toBe(1);
    expect(titles(afterCreate)).toEqual(["delta", "gamma", "beta", "alpha"]);
    expect(afterCreate).toEqual(await freshList());
  });

  it("falls back to a scan when the single-task read cannot answer", async () => {
    const { iterator } = await liveList();

    const afterFailedRead = await nextAfter(iterator, async () => {
      await fs.rm(path.join(tasksDir, beta), { force: true, recursive: true });
      publisher.publish("task.updated", { id: beta });
    });

    expect(scans.count).toBe(2);
    expect(titles(afterFailedRead)).toEqual(["gamma", "alpha"]);
    expect(afterFailedRead).toEqual(await freshList());
  });

  it("honors each subscriber's own sort and limit", async () => {
    const input = { direction: "asc", limit: 2, sortBy: "createdAt" } as const;
    const iterator = await call(task.live.list, input, {
      context: context(),
      signal: controller.signal,
    });

    const first = yielded(await iterator.next());

    expect(first.total).toBe(3);
    expect(titles(first)).toEqual(["alpha", "beta"]);
    expect(first).toEqual(await call(task.list, input, { context: context() }));
  });
});
