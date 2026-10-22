import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectMessage, FromChild, ToChild } from "./protocol";

import { serveConnection } from "./child-host";
import { WORKSPACE_PROCESS_PROTOCOL } from "./protocol";
import {
  createWorkspaceProcessSupervisor,
  HANDSHAKE_TIMEOUT_MS,
  KILL_WAIT_MS,
  RESTART_DELAY_MS,
  SHUTDOWN_GRACE_MS,
  WORKSPACE_PROCESS_RESTART_LIMIT,
  type SpawnedChild,
} from "./supervisor";

/**
 * A child in memory: a pair of ports wired to each other, the real child-side
 * host serving one end, and exit and kill doing what a process's would.
 */
type FakeChild = SpawnedChild & {
  crash(): void;
  exited: boolean;
  /** Set to make the child ignore `shutdown`, as a wedged one would. */
  ignoresShutdown: boolean;
  killed: boolean;
};

function createHarness({
  protocolVersion = WORKSPACE_PROCESS_PROTOCOL,
  silent = false,
}: { protocolVersion?: number; silent?: boolean } = {}) {
  const children: FakeChild[] = [];
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  let nextPid = 100;

  const spawn = ({ nonce }: { nonce: string }): SpawnedChild => {
    const pid = nextPid++;
    const toChild: ((data: unknown) => void)[] = [];
    const toMain: ((data: unknown) => void)[] = [];
    const closeListeners: (() => void)[] = [];
    const exitListeners: ((code: number) => void)[] = [];
    let open = true;
    const closePorts = () => {
      if (!open) return;
      open = false;
      for (const listener of closeListeners) listener();
    };
    const exit = (code: number) => {
      if (child.exited) return;
      child.exited = true;
      closePorts();
      for (const listener of exitListeners) listener(code);
    };
    const child: FakeChild = {
      crash: () => exit(1),
      exited: false,
      ignoresShutdown: false,
      kill: () => {
        child.killed = true;
        exit(1);
      },
      killed: false,
      onExit: (listener) => exitListeners.push(listener),
      pid,
      port: {
        close: closePorts,
        onClose: (listener) => closeListeners.push(listener),
        onMessage: (listener) => toMain.push(listener),
        postMessage: (message: ToChild) => {
          if (!open) return;
          if (message.type === "shutdown" && child.ignoresShutdown) return;
          queueMicrotask(() => {
            for (const listener of toChild) listener(message);
          });
        },
        start: () => {},
      },
    };
    children.push(child);

    if (!silent) {
      const connect: ConnectMessage = {
        build: "1.2.3",
        nonce,
        parentPid: 1,
        type: "connect",
        workspace: { id: "ws", name: "Work" },
      };
      serveConnection({
        connect,
        exit,
        isAlive: () => true,
        pid,
        port: {
          close: closePorts,
          onClose: () => {},
          onMessage: (listener) => toChild.push(listener),
          postMessage: (message: FromChild) => {
            const sent =
              message.type === "response" && "result" in message
                ? {
                    ...message,
                    result: { ...message.result, protocolVersion },
                  }
                : message;
            queueMicrotask(() => {
              if (!open) return;
              for (const listener of toMain) listener(sent);
            });
          },
          start: () => {},
        },
      });
    }
    return child;
  };

  let nonce = 0;
  const supervisor = createWorkspaceProcessSupervisor({
    log,
    now: () => Date.now(),
    randomNonce: () => `nonce-${++nonce}`,
    spawn,
  });
  return { children, log, supervisor };
}

describe("createWorkspaceProcessSupervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes the handshake and answers hello", async () => {
    const { supervisor } = createHarness();
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(supervisor.state).toBe("running");
    expect(await supervisor.hello()).toEqual({
      build: "1.2.3",
      capabilities: [],
      pid: 100,
      protocolVersion: WORKSPACE_PROCESS_PROTOCOL,
      workspace: { id: "ws", name: "Work" },
    });
  });

  it("starts a crashed child again, then gives up past the limit", async () => {
    const { children, log, supervisor } = createHarness();
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);

    for (
      let restart = 0;
      restart < WORKSPACE_PROCESS_RESTART_LIMIT;
      restart++
    ) {
      children.at(-1)?.crash();
      await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS * 2 ** restart);
      expect(supervisor.state).toBe("running");
    }
    expect(children.map((child) => child.pid)).toEqual([100, 101, 102, 103]);

    children.at(-1)?.crash();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(supervisor.state).toBe("failed");
    expect(children).toHaveLength(WORKSPACE_PROCESS_RESTART_LIMIT + 1);
    expect(log.error).toHaveBeenCalledWith(
      "Gave up on the workspace process: it stopped 4 times in 60s",
    );
  });

  it("forgets restarts older than the window", async () => {
    const { children, supervisor } = createHarness();
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);

    for (let crash = 0; crash < WORKSPACE_PROCESS_RESTART_LIMIT + 2; crash++) {
      children.at(-1)?.crash();
      await vi.advanceTimersByTimeAsync(61_000);
    }

    expect(supervisor.state).toBe("running");
  });

  it("does not restart a child Electron says cannot launch", async () => {
    const { children, supervisor } = createHarness();
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);

    // The exit lands first and Electron's reason after it, as it can.
    children[0]?.crash();
    supervisor.noteGone("launch-failed");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(supervisor.state).toBe("failed");
    expect(children).toHaveLength(1);
  });

  it("gives up on a child that speaks another protocol", async () => {
    const { children, supervisor } = createHarness({ protocolVersion: 99 });
    supervisor.start();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(supervisor.state).toBe("failed");
    expect(children).toHaveLength(1);
    expect(children[0]?.killed).toBe(true);
  });

  it("kills a child that never answers the handshake, and counts it", async () => {
    const { children, supervisor } = createHarness({ silent: true });
    supervisor.start();
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS);

    expect(children[0]?.killed).toBe(true);
    await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS);
    expect(children).toHaveLength(2);
  });

  it("stops with shutdown when the child exits on its own", async () => {
    const { children, supervisor } = createHarness();
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);

    const stopped = supervisor.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopped;

    expect(supervisor.state).toBe("stopped");
    expect(children[0]?.exited).toBe(true);
    expect(children[0]?.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
  });

  it("kills a child that ignores shutdown, within the bound", async () => {
    const { children, supervisor } = createHarness();
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const child = children[0];
    if (child) child.ignoresShutdown = true;

    const stopped = supervisor.stop();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS + KILL_WAIT_MS);
    await stopped;

    expect(child?.killed).toBe(true);
    expect(supervisor.state).toBe("stopped");
  });

  it("rejects a pending hello when the child dies", async () => {
    const { children, supervisor } = createHarness();
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);

    const hello = supervisor.hello();
    children[0]?.crash();

    await expect(hello).rejects.toThrow("The workspace process went away");
  });
});

describe("serveConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exits once main's process is gone", async () => {
    const exit = vi.fn();
    let alive = true;
    serveConnection({
      connect: {
        build: "1",
        nonce: "n",
        parentPid: 42,
        type: "connect",
        workspace: { id: "ws", name: "Work" },
      },
      exit,
      isAlive: () => alive,
      pid: 7,
      port: {
        close: () => {},
        onClose: () => {},
        onMessage: () => {},
        postMessage: () => {},
        start: () => {},
      },
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(exit).not.toHaveBeenCalled();

    alive = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(exit).toHaveBeenCalledOnce();
  });
});
