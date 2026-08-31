import { errAsync, okAsync } from "neverthrow";
import { noop } from "radashi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ActorRefFrom,
  type AnyActorRef,
  createActor,
  setup,
  waitFor,
} from "xstate";

import { TypedError } from "../lib/errors";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../lib/workspace-config";
import { type AbsolutePath } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import {
  type BrowserConfig,
  type BrowserTargetId,
  encodeBrowserTargetId,
} from "../types";
import {
  AGENT_IDLE_TIMEOUT_MS,
  RETAINED_TIMEOUT_MS,
  taskBrowserMachine,
  type TaskBrowserParentEvent,
  USER_PRESENCE_TIMEOUT_MS,
} from "./task-browser";

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

vi.mock(import("../lib/agent-browser-cleanup"), () => ({
  closeAgentBrowserSessionsForSessions: vi.fn(asyncNoop),
  closeAllAgentBrowserSessions: vi.fn(asyncNoop),
}));

vi.mock(import("../lib/browser-state"), async (importOriginal) => ({
  ...(await importOriginal()),
  recordBrowserClosed: vi.fn(() => okAsync(undefined)),
}));

const { closeAgentBrowserSessionsForSessions } =
  await import("../lib/agent-browser-cleanup");
const { recordBrowserClosed } = await import("../lib/browser-state");

const createTargetMock: BrowserConfig["createTarget"] = (id, sessionId) =>
  Promise.resolve({ targetId: encodeBrowserTargetId(id, sessionId) });

function makeBrowser(): BrowserConfig {
  return {
    closeTarget: vi.fn(asyncNoop),
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
const partitionDir = "/tmp/partition" as AbsolutePath;

interface Harness {
  actor: ActorRefFrom<typeof taskBrowserMachine>;
  browser: BrowserConfig;
  parentEvents: TaskBrowserParentEvent[];
  parentRef: AnyActorRef;
}

function spawnHarness(): Harness {
  const browser = makeBrowser();
  const parentEvents: TaskBrowserParentEvent[] = [];

  const parentMachine = setup({
    actors: { taskBrowserMachine },
    types: {
      context: {} as {
        childRef: ActorRefFrom<typeof taskBrowserMachine> | null;
      },
      events: {} as TaskBrowserParentEvent,
    },
  }).createMachine({
    context: ({ spawn }) => ({
      childRef: spawn("taskBrowserMachine", {
        id: "child",
        input: { browser, id },
      }),
    }),
    id: "harnessParent",
    on: {
      "taskBrowser.stopped": {
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

const SESSION_A = StoreId.newSessionId();
const TARGET_A: BrowserTargetId = encodeBrowserTargetId(id, SESSION_A);

const captureException = vi.fn();

describe("taskBrowserMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(closeAgentBrowserSessionsForSessions).mockClear();
    vi.mocked(recordBrowserClosed).mockClear();
    captureException.mockClear();
    setWorkspaceConfig({ ...getWorkspaceConfig(), captureException });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("agent idle timer reaps after AGENT_IDLE_TIMEOUT_MS", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledTimes(1);
    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
  });

  it("stays alive while presence is held even after the agent goes idle", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence", value: { level: "visible" } });

    // The user is present (watching), so agent idleness alone must not reap the
    // browser -- reaping waits until they leave (grace period) or nobody watches.
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS * 2);

    expect(actor.getSnapshot().value).toBe("Observed");
    expect(browser.closeTarget).not.toHaveBeenCalled();
  });

  it("reaps after the last presence release and grace period", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence", value: { level: "visible" } });
    actor.send({ type: "acquirePresence", value: { level: "visible" } });
    actor.send({ type: "releasePresence", value: { level: "visible" } });

    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS);
    expect(actor.getSnapshot().value).toBe("Observed");

    actor.send({ type: "releasePresence", value: { level: "visible" } });
    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
  });

  it("survives far past the grace period while the page stays mounted", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence", value: { level: "retained" } });
    actor.send({ type: "acquirePresence", value: { level: "visible" } });

    // The user turns to another task. The page they left is still open, so the
    // short clock -- and the agent's own idle clock -- must not touch it.
    actor.send({ type: "releasePresence", value: { level: "visible" } });
    expect(actor.getSnapshot().value).toBe("Retained");

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS);
    expect(actor.getSnapshot().value).toBe("Retained");
    expect(browser.closeTarget).not.toHaveBeenCalled();

    actor.send({ type: "acquirePresence", value: { level: "visible" } });
    expect(actor.getSnapshot().value).toBe("Observed");
  });

  it("reaps a retained page after RETAINED_TIMEOUT_MS", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence", value: { level: "retained" } });

    await vi.advanceTimersByTimeAsync(RETAINED_TIMEOUT_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
  });

  it("closing the page drops to the short clock even mid-retention", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence", value: { level: "retained" } });

    await vi.advanceTimersByTimeAsync(RETAINED_TIMEOUT_MS / 2);
    actor.send({ type: "releasePresence", value: { level: "retained" } });
    expect(actor.getSnapshot().value).toBe("GracePeriod");

    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
  });

  it("a visible page whose lease outlives the retained one stays Observed", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({ type: "acquirePresence", value: { level: "retained" } });
    actor.send({ type: "acquirePresence", value: { level: "visible" } });
    // Ordering between the two subscriptions is not guaranteed, so a teardown
    // that drops retention first must not reap a page still on screen.
    actor.send({ type: "releasePresence", value: { level: "retained" } });

    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS * 2);

    expect(actor.getSnapshot().value).toBe("Observed");
    expect(browser.closeTarget).not.toHaveBeenCalled();
  });

  it("records the teardown for each session so the next turn can report it", async () => {
    const { actor } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS);

    await waitFor(actor, (s) => s.status === "done");

    expect(recordBrowserClosed).toHaveBeenCalledTimes(1);
    expect(recordBrowserClosed).toHaveBeenCalledWith({
      sessionId: SESSION_A,
      taskId: id,
    });
  });

  it("writes no teardown notice when the reap is a task being trashed", async () => {
    const { actor } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "forceReap" });

    await waitFor(actor, (s) => s.status === "done");

    // The task's folder is already gone by now, so writing the notice would
    // only produce a NotFound that nothing can act on.
    expect(recordBrowserClosed).not.toHaveBeenCalled();
  });

  it("stays quiet when the notice fails because the folder is gone", async () => {
    // A teardown that outlives the trash, or a folder deleted from outside the
    // app, reaches this with nowhere to write. Neither is worth reporting.
    vi.mocked(recordBrowserClosed).mockReturnValueOnce(
      errAsync(new TypedError.NotFound("Folder /gone does not exist")),
    );
    const { actor } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS);

    await waitFor(actor, (s) => s.status === "done");

    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports a notice that failed for any other reason", async () => {
    const failure = new TypedError.Storage("sessions table is locked");
    vi.mocked(recordBrowserClosed).mockReturnValueOnce(errAsync(failure));
    const { actor } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS);

    await waitFor(actor, (s) => s.status === "done");

    expect(captureException).toHaveBeenCalledWith(failure);
  });

  it("cancels the grace period when presence is reacquired", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence", value: { level: "visible" } });
    actor.send({ type: "releasePresence", value: { level: "visible" } });

    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS / 2);
    actor.send({ type: "acquirePresence", value: { level: "visible" } });
    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS);

    expect(actor.getSnapshot().value).toBe("Observed");
    expect(browser.closeTarget).not.toHaveBeenCalled();
  });

  it("reap closes targets, runs daemon cleanup, and notifies parent", async () => {
    const { actor, browser, parentEvents } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({
      type: "attachAgentSession",
      value: { sessionId: SESSION_A },
    });
    actor.send({ type: "forceReap" });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledTimes(1);
    expect(closeAgentBrowserSessionsForSessions).toHaveBeenCalledTimes(1);
    expect(closeAgentBrowserSessionsForSessions).toHaveBeenCalledWith([
      SESSION_A,
    ]);
    expect(parentEvents).toEqual([
      { type: "taskBrowser.stopped", value: { id } },
    ]);
  });

  it("targetDestroyedExternally skips closeTarget but still runs daemon cleanup", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({
      type: "targetDestroyedExternally",
      value: { targetId: TARGET_A },
    });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).not.toHaveBeenCalled();
    expect(closeAgentBrowserSessionsForSessions).toHaveBeenCalledTimes(1);
  });

  it("registerTarget records a user-opened target so reap closes it", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "registerTarget",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "forceReap" });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledTimes(1);
    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
    expect(closeAgentBrowserSessionsForSessions).toHaveBeenCalledWith([
      SESSION_A,
    ]);
  });

  it("registerTarget does not reset the agent idle timer", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS / 2);
    // A user re-opening the panel is not agent activity; it must not extend the
    // idle window.
    actor.send({
      type: "registerTarget",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS / 2);

    await waitFor(actor, (s) => s.status === "done");
    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
  });

  it("ignores registerTarget once teardown has started", async () => {
    const { actor, browser } = spawnHarness();

    // Enter Stopping, then a browser.open createTarget resolves late and fires a
    // registerTarget. It must be ignored, not spawn a destruction watcher on a
    // target that's already being reaped.
    actor.send({ type: "forceReap" });
    actor.send({
      type: "registerTarget",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.onTargetDestroyed).not.toHaveBeenCalled();
    expect(browser.closeTarget).not.toHaveBeenCalled();
  });

  it("targetDestroyedExternally after registerTarget skips closeTarget", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "registerTarget",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({
      type: "targetDestroyedExternally",
      value: { targetId: TARGET_A },
    });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).not.toHaveBeenCalled();
    expect(closeAgentBrowserSessionsForSessions).toHaveBeenCalledTimes(1);
  });

  it("closes one view per session for multi-session tasks", async () => {
    const { actor, browser } = spawnHarness();
    const sessionB = StoreId.newSessionId();
    const targetB: BrowserTargetId = encodeBrowserTargetId(id, sessionB);

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: sessionB, targetId: targetB },
    });

    actor.send({ type: "forceReap" });

    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledTimes(2);
    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
    expect(browser.closeTarget).toHaveBeenCalledWith(targetB);
    expect(closeAgentBrowserSessionsForSessions).toHaveBeenCalledTimes(1);
    expect(closeAgentBrowserSessionsForSessions).toHaveBeenCalledWith(
      expect.arrayContaining([SESSION_A, sessionB]),
    );
  });
});
