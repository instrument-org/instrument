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
import { ProjectSubdomainSchema } from "../schemas/subdomains";
import {
  type BrowserConfig,
  type BrowserTargetId,
  encodeBrowserTargetId,
} from "../types";
import {
  AGENT_IDLE_TIMEOUT_MS,
  projectBrowserMachine,
  type ProjectBrowserParentEvent,
  USER_PRESENCE_TIMEOUT_MS,
} from "./project-browser";

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

const createTargetMock: BrowserConfig["createTarget"] = (
  subdomain,
  sessionId,
) => Promise.resolve({ targetId: encodeBrowserTargetId(subdomain, sessionId) });

function makeBrowser(): BrowserConfig {
  return {
    captureScreenshot: vi.fn(() => Promise.resolve(undefined)),
    closeTarget: vi.fn(asyncNoop),
    createTarget: vi.fn(createTargetMock),
    getTargetMeta: vi.fn(() => null),
    listTargets: vi.fn(emptyTargets),
    onTargetDestroyed: vi.fn(makeDisposer),
    sendCommand: vi.fn(emptyResult),
    subscribeEvents: vi.fn(makeDisposer),
  };
}

const subdomain = ProjectSubdomainSchema.parse("test-project");
const partitionDir = "/tmp/partition" as AbsolutePath;

interface Harness {
  actor: ActorRefFrom<typeof projectBrowserMachine>;
  browser: BrowserConfig;
  parentEvents: ProjectBrowserParentEvent[];
  parentRef: AnyActorRef;
}

function spawnHarness(): Harness {
  const browser = makeBrowser();
  const parentEvents: ProjectBrowserParentEvent[] = [];

  const parentMachine = setup({
    actors: { projectBrowserMachine },
    types: {
      context: {} as {
        childRef: ActorRefFrom<typeof projectBrowserMachine> | null;
      },
      events: {} as ProjectBrowserParentEvent,
    },
  }).createMachine({
    context: ({ spawn }) => ({
      childRef: spawn("projectBrowserMachine", {
        id: "child",
        input: { browser, subdomain },
      }),
    }),
    id: "harnessParent",
    on: {
      "projectBrowser.stopped": {
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
const TARGET_A: BrowserTargetId = encodeBrowserTargetId(subdomain, SESSION_A);

describe("projectBrowserMachine", () => {
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

  it("user presence timer reaps after USER_PRESENCE_TIMEOUT_MS", async () => {
    const { actor } = spawnHarness();

    await vi.advanceTimersByTimeAsync(USER_PRESENCE_TIMEOUT_MS);
    await waitFor(actor, (s) => s.status === "done");

    expect(actor.getSnapshot().value).toBe("Stopped");
  });

  it("updateUserHeartbeat resets only the user timer, not the agent timer", async () => {
    const { actor, browser } = spawnHarness();

    actor.send({
      type: "updateCdpHeartbeat",
      value: { partitionDir, sessionId: SESSION_A, targetId: TARGET_A },
    });

    // Pump heartbeats until just past the agent deadline.
    const tick = USER_PRESENCE_TIMEOUT_MS / 2;
    let elapsed = 0;
    while (elapsed < AGENT_IDLE_TIMEOUT_MS) {
      await vi.advanceTimersByTimeAsync(tick);
      actor.send({ type: "updateUserHeartbeat" });
      elapsed += tick;
    }

    await waitFor(actor, (s) => s.status === "done");
    expect(browser.closeTarget).toHaveBeenCalledTimes(1);
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
      { type: "projectBrowser.stopped", value: { subdomain } },
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
    const targetB: BrowserTargetId = encodeBrowserTargetId(subdomain, sessionB);

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
