import { describe, expect, it } from "vitest";

import { publisher } from "../rpc/publisher";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import {
  type ChangedMessageBatch,
  changedMessageBatches,
} from "./changed-message-batches";

const taskId = TaskIdSchema.parse("task-batches");
const sessionId = StoreId.newSessionId();
const otherSessionId = StoreId.newSessionId();

async function awaitBatch(
  pending: Promise<IteratorResult<ChangedMessageBatch, void>>,
): Promise<ChangedMessageBatch> {
  const result = await pending;
  if (result.done) {
    throw new Error("generator ended without yielding a batch");
  }
  return result.value;
}

function ids(set: Set<StoreId.Message>) {
  return [...set].sort();
}

function partUpdated(messageId: StoreId.Message, session = sessionId) {
  // Only metadata.messageId/sessionId are read by the subscription.
  const part = {
    metadata: {
      createdAt: new Date("2024-01-01T00:00:00Z"),
      id: StoreId.newPartId(),
      messageId,
      sessionId: session,
    },
    state: "done",
    text: "",
    type: "text",
  } satisfies SessionMessagePart.Type;
  publisher.publish("part.updated", { id: taskId, part });
}

function start(signal: AbortSignal) {
  const batches = changedMessageBatches({ id: taskId, sessionId }, signal);
  return { batches, first: batches.next() };
}

describe("changedMessageBatches", () => {
  it("captures every distinct message id published in one tick (no drops)", async () => {
    const controller = new AbortController();
    const { batches, first } = start(controller.signal);

    const a = StoreId.newMessageId();
    const b = StoreId.newMessageId();
    const c = StoreId.newMessageId();

    // Synchronous burst across three messages. The publisher buffers only one
    // event per subscription, so an iterator-per-event consumer would miss two
    // of these; the id set keeps all three.
    partUpdated(a);
    partUpdated(b);
    partUpdated(c);

    const batch = await awaitBatch(first);
    expect(ids(batch.updated)).toEqual([a, b, c].sort());

    await batches.return();
  });

  it("captures events published before the first pull", async () => {
    const controller = new AbortController();
    // Subscriptions register at call time, so events raised while a caller is
    // still taking its initial snapshot land in the first batch.
    const batches = changedMessageBatches(
      { id: taskId, sessionId },
      controller.signal,
    );

    const a = StoreId.newMessageId();
    partUpdated(a);

    const batch = await awaitBatch(batches.next());
    expect(ids(batch.updated)).toEqual([a]);

    await batches.return();
  });

  it("return() settles a pending pull and unsubscribes", async () => {
    const controller = new AbortController();
    const sizeBefore = publisher.size;
    const { batches, first } = start(controller.signal);

    await batches.return();

    const { done } = await first;
    expect(done).toBe(true);
    expect(publisher.size).toBe(sizeBefore);

    // Listeners are gone: a publish after teardown yields nothing.
    partUpdated(StoreId.newMessageId());
    const after = await batches.next();
    expect(after.done).toBe(true);
  });

  it("coalesces a burst for one message into a single batch entry", async () => {
    const controller = new AbortController();
    const { batches, first } = start(controller.signal);

    const a = StoreId.newMessageId();
    for (let i = 0; i < 50; i++) {
      partUpdated(a);
    }

    const batch = await awaitBatch(first);
    expect(ids(batch.updated)).toEqual([a]);

    await batches.return();
  });

  it("ignores events from other sessions", async () => {
    const controller = new AbortController();
    const { batches, first } = start(controller.signal);

    const mine = StoreId.newMessageId();
    partUpdated(StoreId.newMessageId(), otherSessionId);
    partUpdated(mine);

    const batch = await awaitBatch(first);
    expect(ids(batch.updated)).toEqual([mine]);

    await batches.return();
  });

  it("moves a removed message out of updated, and a later update re-adds it", async () => {
    const controller = new AbortController();
    const { batches, first } = start(controller.signal);

    const a = StoreId.newMessageId();

    partUpdated(a);
    publisher.publish("message.removed", {
      id: taskId,
      messageId: a,
      sessionId,
    });

    const firstBatch = await awaitBatch(first);
    expect(ids(firstBatch.updated)).toEqual([]);
    expect(ids(firstBatch.removed)).toEqual([a]);

    partUpdated(a);
    const secondBatch = await awaitBatch(batches.next());
    expect(ids(secondBatch.updated)).toEqual([a]);
    expect(ids(secondBatch.removed)).toEqual([]);

    await batches.return();
  });

  it("ends the loop when the signal aborts", async () => {
    const controller = new AbortController();
    const { first } = start(controller.signal);

    controller.abort();

    const { done } = await first;
    expect(done).toBe(true);
  });
});
