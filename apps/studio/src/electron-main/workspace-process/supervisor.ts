import {
  isFromChild,
  type ToChild,
  WORKSPACE_PROCESS_PROTOCOL,
  type WorkspaceProcessHello,
} from "./protocol";

/**
 * How many times the child is started again within {@link RESTART_WINDOW_MS}
 * before main gives up on it. A child that keeps dying is a bug in it, and
 * starting it forever turns that bug into a busy loop.
 */
export const WORKSPACE_PROCESS_RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 60_000;
/** The wait before the first restart, doubled for each recent one. */
export const RESTART_DELAY_MS = 500;
/** How long a new child has to answer `ready` with its nonce. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5000;
/** How long a child has to exit after `shutdown` before it is killed. */
export const SHUTDOWN_GRACE_MS = 2000;
/** How long a kill gets to land before the stop resolves anyway. */
export const KILL_WAIT_MS = 1000;

/**
 * Ways a child ends that another start would only repeat. The first two are
 * Electron's `child-process-gone` reasons for a binary that cannot run; the
 * last is a child built from other sources than main.
 */
const NON_RECOVERABLE = new Set([
  "integrity-failure",
  "launch-failed",
  "protocol-mismatch",
]);

/** Main's end of the channel to one child. */
type MainPort = {
  close(): void;
  onClose(listener: () => void): void;
  onMessage(listener: (data: unknown) => void): void;
  postMessage(message: ToChild): void;
  start(): void;
};

/** A child as forked, with the channel already handed over. */
export type SpawnedChild = {
  kill(): void;
  onExit(listener: (code: number) => void): void;
  readonly pid: number | undefined;
  port: MainPort;
};

type Logger = {
  error(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

type Pending = {
  reject: (error: Error) => void;
  resolve: (hello: WorkspaceProcessHello) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Generation = {
  child: SpawnedChild;
  /** Settles when the process has exited, which can come after its port closes. */
  exited: Promise<void>;
  gone: boolean;
  handshake: ReturnType<typeof setTimeout>;
  pending: Map<number, Pending>;
  /** Read while the child runs: a process's pid is gone once it has exited. */
  pid: number | undefined;
  ready: boolean;
  reason: string | undefined;
};

type WorkspaceProcessState =
  | "failed"
  | "running"
  | "starting"
  | "stopped"
  | "stopping";

/**
 * Keeps one workspace child running: forks it, checks the handshake and its
 * `hello`, notices it is gone by whichever signal comes first (its exit, its
 * port closing, or Electron's `child-process-gone` through {@link noteGone}),
 * starts it again within {@link WORKSPACE_PROCESS_RESTART_LIMIT}, and stops it
 * on quit with a `shutdown`, a bounded wait, and a kill.
 */
export function createWorkspaceProcessSupervisor({
  log,
  now = Date.now,
  randomNonce,
  spawn,
}: {
  log: Logger;
  now?: () => number;
  randomNonce: () => string;
  spawn: (options: { nonce: string }) => SpawnedChild;
}) {
  let state: WorkspaceProcessState = "stopped";
  let current: Generation | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let nextRequestId = 1;
  const restarts: number[] = [];

  function startGeneration() {
    state = "starting";
    const nonce = randomNonce();
    const child = spawn({ nonce });
    const exited = new Promise<void>((resolve) => {
      child.onExit(() => resolve());
    });
    const generation: Generation = {
      child,
      exited,
      gone: false,
      handshake: setTimeout(() => {
        log.warn(
          `Workspace process ${generation.pid ?? "?"} did not answer the handshake in ${HANDSHAKE_TIMEOUT_MS}ms`,
        );
        child.kill();
        markGone(generation, "handshake-timeout");
      }, HANDSHAKE_TIMEOUT_MS),
      pending: new Map(),
      pid: child.pid,
      ready: false,
      reason: undefined,
    };
    current = generation;

    child.port.onMessage((data) => {
      if (!isFromChild(data) || generation.gone) {
        return;
      }
      if (data.type === "ready") {
        if (data.nonce !== nonce || generation.ready) {
          log.warn("Workspace process answered with the wrong nonce");
          return;
        }
        generation.ready = true;
        generation.pid ??= child.pid;
        clearTimeout(generation.handshake);
        void greet(generation);
        return;
      }
      const pending = generation.pending.get(data.id);
      if (!pending) {
        return;
      }
      generation.pending.delete(data.id);
      clearTimeout(pending.timer);
      if ("error" in data) {
        pending.reject(new Error(data.error));
      } else {
        pending.resolve(data.result);
      }
    });
    child.port.onClose(() => markGone(generation, "port-closed"));
    child.onExit((code) =>
      markGone(generation, code === 0 ? "clean-exit" : "abnormal-exit"),
    );
    child.port.start();
  }

  async function greet(generation: Generation) {
    try {
      const hello = await request(generation);
      if (hello.protocolVersion !== WORKSPACE_PROCESS_PROTOCOL) {
        log.error(
          `Workspace process speaks protocol ${hello.protocolVersion}, main speaks ${WORKSPACE_PROCESS_PROTOCOL}`,
        );
        generation.reason = "protocol-mismatch";
        generation.child.kill();
        return;
      }
      if (generation === current && state === "starting") {
        state = "running";
      }
      log.info(`Workspace process ${hello.pid} answered hello`, hello);
    } catch (error) {
      log.warn("Workspace process did not answer hello", error);
    }
  }

  function request(generation: Generation): Promise<WorkspaceProcessHello> {
    if (generation.gone || !generation.ready) {
      return Promise.reject(new Error("The workspace process is not running"));
    }
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        generation.pending.delete(id);
        reject(new Error(`hello got no answer in ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      generation.pending.set(id, { reject, resolve, timer });
      generation.child.port.postMessage({
        id,
        method: "hello",
        type: "request",
      });
    });
  }

  function markGone(generation: Generation, reason: string) {
    if (generation.gone) {
      // A later signal can say more about the same death than the first did.
      if (NON_RECOVERABLE.has(reason)) {
        generation.reason = reason;
      }
      return;
    }
    generation.gone = true;
    generation.reason ??= reason;
    clearTimeout(generation.handshake);
    // A closed connection cancels everything that was waiting on it.
    for (const pending of generation.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("The workspace process went away"));
    }
    generation.pending.clear();
    generation.child.port.close();

    if (state === "stopping" || state === "stopped" || state === "failed") {
      return;
    }
    log.warn(
      `Workspace process ${generation.pid ?? "?"} is gone (${generation.reason})`,
    );
    scheduleRestart(generation);
  }

  function scheduleRestart(generation: Generation) {
    if (generation.reason && NON_RECOVERABLE.has(generation.reason)) {
      fail(`it cannot run (${generation.reason})`);
      return;
    }
    const windowStart = now() - RESTART_WINDOW_MS;
    while (restarts[0] !== undefined && restarts[0] < windowStart) {
      restarts.shift();
    }
    if (restarts.length >= WORKSPACE_PROCESS_RESTART_LIMIT) {
      fail(
        `it stopped ${restarts.length + 1} times in ${RESTART_WINDOW_MS / 1000}s`,
      );
      return;
    }
    const delay = RESTART_DELAY_MS * 2 ** restarts.length;
    state = "starting";
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      // Checked when the restart is due rather than when the death was first
      // seen, since Electron's reason can arrive after the exit.
      if (generation.reason && NON_RECOVERABLE.has(generation.reason)) {
        fail(`it cannot run (${generation.reason})`);
        return;
      }
      restarts.push(now());
      log.info(
        `Starting the workspace process again (${restarts.length} of ${WORKSPACE_PROCESS_RESTART_LIMIT})`,
      );
      startGeneration();
    }, delay);
  }

  function fail(why: string) {
    state = "failed";
    log.error(`Gave up on the workspace process: ${why}`);
  }

  return {
    /** Asks the running child about itself. */
    hello(): Promise<WorkspaceProcessHello> {
      return current
        ? request(current)
        : Promise.reject(new Error("The workspace process is not running"));
    },

    /**
     * Electron's `child-process-gone` for this child's service. It carries no
     * pid, so it is taken to be about the child that died last if a restart is
     * still pending, and about the running one otherwise.
     */
    noteGone(reason: string) {
      if (current) {
        markGone(current, reason);
      }
    },

    /** The running child's pid, while there is one. */
    get pid() {
      return current && !current.gone ? current.child.pid : undefined;
    },

    start() {
      if (state !== "stopped") {
        return;
      }
      startGeneration();
    },

    get state() {
      return state;
    },

    /**
     * Ends the child: `shutdown`, then up to {@link SHUTDOWN_GRACE_MS} for it
     * to exit, then a kill and up to {@link KILL_WAIT_MS} more. Resolves within
     * {@link SHUTDOWN_GRACE_MS} + {@link KILL_WAIT_MS} whatever the child
     * does.
     */
    async stop() {
      const wasFailed = state === "failed";
      state = "stopping";
      clearTimeout(restartTimer);
      restartTimer = undefined;
      const generation = current;
      if (!generation || generation.gone) {
        state = wasFailed ? "failed" : "stopped";
        return;
      }
      const started = now();
      try {
        generation.child.port.postMessage({ type: "shutdown" });
      } catch {
        // A port that cannot take the message is a child the kill will end.
      }
      if (await settlesWithin(generation.exited, SHUTDOWN_GRACE_MS)) {
        log.info(
          `Workspace process ${generation.pid ?? "?"} exited ${now() - started}ms after shutdown`,
        );
      } else {
        log.warn(
          `Workspace process ${generation.pid ?? "?"} did not exit in ${SHUTDOWN_GRACE_MS}ms after shutdown; killing it`,
        );
        generation.child.kill();
        await settlesWithin(generation.exited, KILL_WAIT_MS);
      }
      state = "stopped";
    },
  };
}

async function settlesWithin(
  promise: Promise<void>,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
