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

function makeBrowser(): BrowserConfig {
  return {
    closeTarget: vi.fn(asyncNoop),
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

const id = TaskIdSchema.parse("test-task");
const TARGET: BrowserTargetId = encodeArtifactTargetId(id);

interface Harness {
  actor: ActorRefFrom<typeof artifactPreviewMachine>;
  browser: BrowserConfig;
  parentEvents: ArtifactPreviewParentEvent[];
  parentRef: AnyActorRef;
}

function spawnHarness(): Harness {
  const browser = makeBrowser();
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
