import { noop } from "radashi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ActorRefFrom,
  type AnyActorRef,
  createActor,
  setup,
  waitFor,
} from "xstate";

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

const { closeAgentBrowserSessionsForSessions } = await import(
  "../lib/agent-browser-cleanup"
);

const createTargetMock: BrowserConfig["createTarget"] = (id, sessionId) =>
  Promise.resolve({ targetId: encodeBrowserTargetId(id, sessionId) });

function makeBrowser(): BrowserConfig {
  return {
    captureScreenshot: vi.fn(() => Promise.resolve(undefined)),
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

const id = TaskIdSchema.parse("test-project");
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

describe("taskBrowserMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(closeAgentBrowserSessionsForSessions).mockClear();
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

  it("reaps after agent inactivity even while presence is acquired", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence" });

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
  });

  it("browser activity resets the idle timer while presence is acquired", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence" });

    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS / 2);
    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS / 2);

    expect(actor.getSnapshot().value).toBe("Observed");
    expect(browser.closeTarget).not.toHaveBeenCalled();
  });

  it("reaps after the last presence release and grace period", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence" });
    actor.send({ type: "acquirePresence" });
    actor.send({ type: "releasePresence" });

    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS);
    expect(actor.getSnapshot().value).toBe("Observed");

    actor.send({ type: "releasePresence" });
    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(browser.closeTarget).toHaveBeenCalledWith(TARGET_A);
  });

  it("cancels the grace period when presence is reacquired", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });
    actor.send({ type: "acquirePresence" });
    actor.send({ type: "releasePresence" });

    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS / 2);
    actor.send({ type: "acquirePresence" });
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

  it("closes one view per session for multi-session projects", async () => {
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
