import { describe, expect, it } from "vitest";

import { type Task } from "../schemas/task";
import { TaskIdSchema } from "../schemas/task-id";
import { LiveTasksSnapshot } from "./live-tasks-snapshot";

function task(id: string, day: number): Task {
  return {
    createdAt: new Date(`2026-01-0${day}T00:00:00.000Z`),
    id: TaskIdSchema.parse(id),
    title: id,
    updatedAt: new Date(`2026-02-0${day}T00:00:00.000Z`),
  };
}

function titles(list: { tasks: Task[] }) {
  return list.tasks.map((entry) => entry.title);
}

describe("LiveTasksSnapshot", () => {
  it("orders by the subscriber's sort, not by insertion order", () => {
    const snapshot = new LiveTasksSnapshot();
    snapshot.upsert(task("beta", 2));
    snapshot.upsert(task("gamma", 3));
    snapshot.upsert(task("alpha", 1));

    expect(titles(snapshot.list({ sortBy: "updatedAt" }))).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
    expect(
      titles(snapshot.list({ direction: "asc", sortBy: "createdAt" })),
    ).toEqual(["alpha", "beta", "gamma"]);
  });

  it("limits the tasks it returns while counting every one it holds", () => {
    const snapshot = new LiveTasksSnapshot([
      task("alpha", 1),
      task("beta", 2),
      task("gamma", 3),
    ]);

    const listed = snapshot.list({ limit: 2 });

    expect(titles(listed)).toEqual(["gamma", "beta"]);
    expect(listed.total).toBe(3);
  });

  it("re-sorts when an upsert replaces a task with a newer one", () => {
    const alpha = task("alpha", 1);
    const snapshot = new LiveTasksSnapshot([alpha, task("beta", 2)]);

    snapshot.upsert({
      ...alpha,
      title: "alpha renamed",
      updatedAt: new Date("2026-02-04T00:00:00.000Z"),
    });

    expect(titles(snapshot.list({}))).toEqual(["alpha renamed", "beta"]);
  });

  it("adds a task it has never held", () => {
    const snapshot = new LiveTasksSnapshot([task("alpha", 1)]);

    snapshot.upsert(task("delta", 4));

    expect(titles(snapshot.list({}))).toEqual(["delta", "alpha"]);
  });

  it("drops a removed task and leaves the rest ordered", () => {
    const snapshot = new LiveTasksSnapshot([
      task("alpha", 1),
      task("beta", 2),
      task("gamma", 3),
    ]);

    snapshot.remove(TaskIdSchema.parse("beta"));

    expect(titles(snapshot.list({}))).toEqual(["gamma", "alpha"]);
  });

  it("removing an unknown id is a no-op", () => {
    const snapshot = new LiveTasksSnapshot([task("alpha", 1)]);

    snapshot.remove(TaskIdSchema.parse("beta"));

    expect(titles(snapshot.list({}))).toEqual(["alpha"]);
  });

  it("reset replaces the whole contents", () => {
    const snapshot = new LiveTasksSnapshot([task("alpha", 1)]);

    snapshot.reset([task("beta", 2), task("gamma", 3)]);

    expect(titles(snapshot.list({}))).toEqual(["gamma", "beta"]);
  });
});
