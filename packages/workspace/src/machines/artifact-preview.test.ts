import { noop } from "radashi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ActorRefFrom,
  type AnyActorRef,
  createActor,
  setup,
  waitFor,
} from "xstate";

import { TaskIdSchema } from "../schemas/task-id";
import {
  type BrowserConfig,
  type BrowserTargetId,
  encodeArtifactTargetId,
  encodeBrowserTargetId,
} from "../types";
import {
  ARTIFACT_PREVIEW_GRACE_MS,
  artifactPreviewMachine,
  type ArtifactPreviewParentEvent,
} from "./artifact-preview";

function asyncNoop(): Promise<void> {
  return Promise.resolve();
}

function disposerNoop(): void {
  // intentionally empty
}

function emptyResult(): Promise<Record<string, never>> {
  return Promise.resolve({});
}

function emptyTargets(): Promise<never[]> {
  return Promise.resolve([]);
}

function makeDisposer(): () => void {
  return disposerNoop;
}

// Agent-browser daemon cleanup must never run for a preview: it has no session.
// Mocked so the assertion is about this machine, not about the module's own
// no-op behavior.
vi.mock(import("../lib/agent-browser-cleanup"), () => ({
  closeAgentBrowserSessionsForSessions: vi.fn(asyncNoop),
  closeAllAgentBrowserSessions: vi.fn(asyncNoop),
}));

const { closeAgentBrowserSessionsForSessions } =
  await import("../lib/agent-browser-cleanup");

const createArtifactTargetMock: BrowserConfig["createArtifactTarget"] = (id) =>
  Promise.resolve({ targetId: encodeArtifactTargetId(id) });

const createTargetMock: BrowserConfig["createTarget"] = (id, sessionId) =>
  Promise.resolve({ targetId: encodeBrowserTargetId(id, sessionId) });

function makeBrowser(
  closeTarget: BrowserConfig["closeTarget"] = vi.fn(asyncNoop),
): BrowserConfig {
  return {
    closeTarget,
    createArtifactTarget: vi.fn(createArtifactTargetMock),
    createTarget: vi.fn(createTargetMock),
    getTargetMeta: vi.fn(() => null),
    listTargets: vi.fn(emptyTargets),
    onTargetDestroyed: vi.fn(makeDisposer),
    sendCommand: vi.fn(emptyResult),
    stopScreencast: vi.fn(noop),
    subscribeEvents: vi.fn(makeDisposer),
  };
}

// A close that only settles when the test says so, for the teardown race: with
// the default instant close, Stopping is entered and left inside one tick and
// there is no window to send anything into.
function makeDeferredClose() {
  let released = false;
  const pending: (() => void)[] = [];
  const closeTarget = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        if (released) {
          resolve();
          return;
        }
        pending.push(() => {
          resolve();
        });
      }),
  );
  return {
    closeTarget,
    // Latches, so a teardown that runs a second pass to close a late target
    // does not hang waiting for a release the test already gave.
    release: () => {
      released = true;
      for (const resolve of pending.splice(0)) {
        resolve();
      }
    },
  };
}

const id = TaskIdSchema.parse("test-task");
const TARGET: BrowserTargetId = encodeArtifactTargetId(id);

interface Harness {
  actor: ActorRefFrom<typeof artifactPreviewMachine>;
  browser: BrowserConfig;
  parentEvents: ArtifactPreviewParentEvent[];
  parentRef: AnyActorRef;
}

function spawnHarness(closeTarget?: BrowserConfig["closeTarget"]): Harness {
  const browser = makeBrowser(closeTarget);
  const parentEvents: ArtifactPreviewParentEvent[] = [];

  const parentMachine = setup({
    actors: { artifactPreviewMachine },
    types: {
      context: {} as {
        childRef: ActorRefFrom<typeof artifactPreviewMachine> | null;
      },
      events: {} as ArtifactPreviewParentEvent,
    },
  }).createMachine({
    context: ({ spawn }) => ({
      childRef: spawn("artifactPreviewMachine", {
        id: "child",
        input: { browser, id },
      }),
    }),
    id: "harnessParent",
    on: {
      "artifactPreview.stopped": {
        actions: ({ event }) => {
          parentEvents.push(event);
        },
      },
    },
  });

  const parentRef = createActor(parentMachine).start();
  const childRef = parentRef.getSnapshot().context.childRef;
  if (!childRef) {
    throw new Error("childRef should have been spawned");
  }

  return { actor: childRef, browser, parentEvents, parentRef };
}

describe("artifactPreviewMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(closeAgentBrowserSessionsForSessions).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reaps a target nobody ever leased once the grace period elapses", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });

    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledExactlyOnceWith(TARGET);
  });

  it("stays alive indefinitely while a preview holds presence", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    actor.send({ type: "acquirePresence" });

    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS * 10);

    expect(actor.getSnapshot().value).toBe("Observed");
    expect(browser.closeTarget).not.toHaveBeenCalled();
  });

  // The panel and the expand modal over it lease the same guest, so the count
  // has to drain to zero before the grace clock starts.
  it("reaps only after the last of two leases releases", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    actor.send({ type: "acquirePresence" });
    actor.send({ type: "acquirePresence" });
    actor.send({ type: "releasePresence" });

    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS);
    expect(actor.getSnapshot().value).toBe("Observed");

    actor.send({ type: "releasePresence" });
    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET);
  });

  // Switching between two HTML files drops and re-acquires the lease within a
  // frame or two; that must not cost a destroy/create cycle.
  it("cancels the grace period when presence is reacquired", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    actor.send({ type: "acquirePresence" });
    actor.send({ type: "releasePresence" });

    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS / 2);
    actor.send({ type: "acquirePresence" });
    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS);

    expect(actor.getSnapshot().value).toBe("Observed");
    expect(browser.closeTarget).not.toHaveBeenCalled();
  });

  it("forceReap closes the target and notifies the parent", async () => {
    const { actor, browser, parentEvents } = spawnHarness();

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    actor.send({ type: "acquirePresence" });
    actor.send({ type: "forceReap" });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledExactlyOnceWith(TARGET);
    expect(parentEvents).toEqual([
      { type: "artifactPreview.stopped", value: { id } },
    ]);
  });

  // A viewer reopening the preview in the moment its idle teardown began must
  // not be dropped: the machine would reach Stopped, the parent would forget
  // it, and nothing would re-lease, so the panel would rebuild a guest that is
  // reaped again every grace period for as long as someone is looking at it.
  it("comes back to Observed when presence arrives mid-teardown", async () => {
    const { closeTarget, release } = makeDeferredClose();
    const { actor } = spawnHarness(closeTarget);

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS);
    expect(actor.getSnapshot().value).toBe("Stopping");

    actor.send({ type: "acquirePresence" });
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toBe("Observed");
    expect(actor.getSnapshot().status).toBe("active");
    // The guest it just closed is gone; the panel's open registers a new one.
    expect(actor.getSnapshot().context.targetId).toBeNull();
  });

  it("still reaps mid-teardown presence that never arrives", async () => {
    const { actor, parentEvents } = spawnHarness();

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(parentEvents).toEqual([
      { type: "artifactPreview.stopped", value: { id } },
    ]);
  });

  // Trashing a task orders teardown, and that is final -- a lease landing in
  // the same tick must not revive a preview for a task on its way out.
  it("does not revive after a forced reap even if presence arrives", async () => {
    const { closeTarget, release } = makeDeferredClose();
    const { actor } = spawnHarness(closeTarget);

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    actor.send({ type: "forceReap" });
    expect(actor.getSnapshot().value).toBe("Stopping");

    actor.send({ type: "acquirePresence" });
    release();
    await waitFor(actor, (s) => s.status === "done");

    expect(actor.getSnapshot().value).toBe("Stopped");
  });

  // An open already in flight can resolve after teardown started. The close
  // captured the id it was given on entry, so a target registered afterwards is
  // one nobody would ever close -- a leaked webContents for the life of the app.
  it("closes a target registered after teardown began", async () => {
    const { closeTarget, release } = makeDeferredClose();
    const { actor, browser } = spawnHarness(closeTarget);

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS);
    expect(actor.getSnapshot().value).toBe("Stopping");

    const late = encodeArtifactTargetId(TaskIdSchema.parse("late-task"));
    actor.send({ type: "registerTarget", value: { targetId: late } });
    release();
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledTimes(2);
    expect(browser.closeTarget).toHaveBeenLastCalledWith(late);
  });

  // Same race, but someone is watching again: the late target is the live one,
  // so it is kept rather than closed.
  it("adopts a late target when presence is held", async () => {
    const { closeTarget, release } = makeDeferredClose();
    const { actor, browser } = spawnHarness(closeTarget);

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    await vi.advanceTimersByTimeAsync(ARTIFACT_PREVIEW_GRACE_MS);

    const late = encodeArtifactTargetId(TaskIdSchema.parse("late-task"));
    actor.send({ type: "acquirePresence" });
    actor.send({ type: "registerTarget", value: { targetId: late } });
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toBe("Observed");
    expect(actor.getSnapshot().context.targetId).toBe(late);
    expect(browser.closeTarget).toHaveBeenCalledExactlyOnceWith(TARGET);
  });

  it("never runs agent-browser daemon cleanup", async () => {
    const { actor } = spawnHarness();

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    actor.send({ type: "forceReap" });
    await waitFor(actor, (s) => s.status === "done");

    expect(closeAgentBrowserSessionsForSessions).not.toHaveBeenCalled();
  });

  it("skips closeTarget when the guest died under it", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({ type: "registerTarget", value: { targetId: TARGET } });
    actor.send({ type: "targetDestroyedExternally" });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).not.toHaveBeenCalled();
  });

  // A lease can arrive before the open RPC registers what it created, so the
  // teardown path has to tolerate having no target at all.
  it("stops cleanly when no target was ever registered", async () => {
    const { actor, browser, parentEvents } = spawnHarness();

    actor.send({ type: "acquirePresence" });
    actor.send({ type: "forceReap" });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).not.toHaveBeenCalled();
    expect(parentEvents).toEqual([
      { type: "artifactPreview.stopped", value: { id } },
    ]);
  });
});
