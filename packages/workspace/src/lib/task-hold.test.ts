import { noop } from "radashi";
import { describe, expect, it } from "vitest";

import { publisher } from "../rpc/publisher";
import { TaskIdSchema } from "../schemas/task-id";
import { cancelHold, holdTask, queueBehindHold, taskHold } from "./task-hold";

let counter = 0;

/** A promise and the function that settles it. */
function answer<T>() {
  let settle: (value: T) => void = noop;
  let fail: (error: Error) => void = noop;
  const until = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { fail, settle, until };
}

/** Lets every `then` queued on a settled promise run. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function newTaskId() {
  counter += 1;
  return TaskIdSchema.parse(`held-task-${counter}`);
}

function updatesFor(taskId: string) {
  const seen: string[] = [];
  const controller = new AbortController();
  void (async () => {
    for await (const event of publisher.subscribe("task.updated", {
      signal: controller.signal,
    })) {
      if (event.id === taskId) {
        seen.push(event.id);
      }
    }
  })().catch(noop);
  return {
    seen,
    stop: () => {
      controller.abort();
    },
  };
}

describe("holdTask", () => {
  it("starts the task with what the hold settled to, then what was queued behind it, in order", async () => {
    const taskId = newTaskId();
    const events: string[] = [];
    const { settle, until } = answer<string[]>();
    holdTask(taskId, {
      reason: 'macOS is asking the user about "Desktop"',
      start: (refusals) => events.push(`start ${refusals.join(",") || "-"}`),
      until,
      userReason: "Waiting for you to allow access to Desktop",
    });

    expect(taskHold(taskId)).toMatchObject({
      reason: 'macOS is asking the user about "Desktop"',
      userReason: "Waiting for you to allow access to Desktop",
    });
    expect(queueBehindHold(taskId, () => events.push("first send"))).toBe(true);
    expect(queueBehindHold(taskId, () => events.push("second send"))).toBe(
      true,
    );
    expect(events).toEqual([]);

    settle([]);
    await flush();

    expect(events).toMatchInlineSnapshot(`
      [
        "start -",
        "first send",
        "second send",
      ]
    `);
    expect(taskHold(taskId)).toBeUndefined();
    expect(queueBehindHold(taskId, () => events.push("late"))).toBe(false);
  });

  it("never starts a task whose hold was canceled, nor anything queued behind it", async () => {
    const taskId = newTaskId();
    const events: string[] = [];
    const { settle, until } = answer<undefined>();
    holdTask(taskId, {
      reason: "waiting on a sign-in",
      start: () => events.push("start"),
      until,
      userReason: "Waiting for you to sign in",
    });
    queueBehindHold(taskId, () => events.push("send"));

    expect(cancelHold(taskId)?.reason).toBe("waiting on a sign-in");
    expect(cancelHold(taskId)).toBeUndefined();
    settle(undefined);
    await flush();

    expect(events).toEqual([]);
    expect(taskHold(taskId)).toBeUndefined();
  });

  it("drops a hold whose cause rejects, as a cancel would", async () => {
    const taskId = newTaskId();
    const events: string[] = [];
    const { fail, until } = answer<undefined>();
    holdTask(taskId, {
      reason: "rate limited",
      start: () => events.push("start"),
      until,
      userReason: "Waiting for the provider",
    });

    fail(new Error("gone"));
    await flush();

    expect(events).toEqual([]);
    expect(taskHold(taskId)).toBeUndefined();
  });

  it("tells listeners when a task is held and when it lets go", async () => {
    const taskId = newTaskId();
    const updates = updatesFor(taskId);
    await flush();
    const { settle, until } = answer<undefined>();
    holdTask(taskId, {
      reason: "r",
      start: noop,
      until,
      userReason: "u",
    });
    settle(undefined);
    await flush();
    updates.stop();

    expect(updates.seen).toHaveLength(2);
  });
});
