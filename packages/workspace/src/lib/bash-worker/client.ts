import { type ExecOptions } from "just-bash";
import { AsyncLocalStorage } from "node:async_hooks";
import { type Worker, type WorkerOptions } from "node:worker_threads";
import { omit, pick } from "radashi";

import { type AppToolInvoker, appToolHook } from "../app-tool-hook";
import { type BashEnvOptions, type BashRunner } from "../create-bash-env";
import { ensureTaskVenvForTask } from "../ensure-task-venv";
import {
  currentShellOutputSink,
  type ShellOutputSink,
} from "../shell-commands/output-sink";
import { terminateSubprocessTree } from "../subprocess-tree";
import { getWorkspaceConfig } from "../workspace-config";
import { recordWorkspaceSkillMutation } from "../workspace-skill-index";
import {
  fromWireError,
  type FromWorker,
  toWireError,
  toWireResult,
  type ToWorker,
  type WireResult,
  WORKER_CONFIG_KEYS,
} from "./protocol";
import { dirOf, resolveRecord } from "../record-folders";

/**
 * Starts the worker. The host supplies it because only the host knows where
 * the worker's code is: Studio's build emits it as its own chunk, and tests
 * and scripts run it from source through tsx.
 */
export type BashWorkerFactory = (options: WorkerOptions) => Worker;

interface PendingExec {
  /** Proxied calls in flight, by call id. */
  calls: Map<number, AbortController>;
  /**
   * Runs a callback in the async context `exec` was called in, so a proxied
   * command sees the turn and output sink it would have seen on this thread.
   */
  inContext: <R>(callback: () => R) => R;
  /** Makes a `js-exec` script's app tool calls for the task the shell belongs to. */
  invokeTool: AppToolInvoker;
  /** The main-thread shell proxied commands run in, built on first use. */
  mainBash?: Promise<BashRunner>;
  mainBashFactory: () => Promise<BashRunner>;
  reject: (error: Error) => void;
  resolve: (result: WireResult) => void;
  signal?: AbortSignal;
  sink?: ShellOutputSink;
  /** Chunks delivered to the sink so far, in order. Never rejects. */
  sinkDone: Promise<void>;
}

/**
 * One started worker and everything owed to it. A replacement gets its own, so
 * nothing left over from a dead worker can settle a newer one's calls.
 */
interface WorkerInstance {
  pending: Map<number, PendingExec>;
  post: (message: ToWorker) => void;
  retired: boolean;
  /** Process trees the worker started whose leader it has not seen settle. */
  trees: Set<number>;
  worker: Worker;
}

let factory: BashWorkerFactory | undefined;
let current: undefined | WorkerInstance;
let nextId = 0;

/**
 * Whether `createBashEnv` runs the interpreter in the worker: whenever the host
 * has said how to start one, unless `INSTRUMENT_BASH_WORKER=0` keeps it on this
 * thread.
 */
export function bashWorkerEnabled(): boolean {
  return factory !== undefined && process.env.INSTRUMENT_BASH_WORKER !== "0";
}

/**
 * A shell whose interpreter, filesystem and host-work commands run in one
 * long-lived worker thread shared by every call, and whose
 * `MAIN_THREAD_COMMANDS` come back here to run against a shell built on this
 * thread from the same options.
 */
export function createRemoteBash(
  options: BashEnvOptions,
  mainBashFactory: () => Promise<BashRunner>,
  invokeTool: AppToolInvoker = appToolHook(options.taskId),
): BashRunner {
  return {
    exec: (command, { signal, ...execOptions }: ExecOptions = {}) =>
      new Promise((resolve, reject) => {
        const instance = getInstance();
        const id = nextId++;
        const sink = currentShellOutputSink();
        const onAbort = () => {
          instance.post({ id, type: "abort" });
        };
        const settle = () => {
          signal?.removeEventListener("abort", onAbort);
          instance.pending.delete(id);
          if (instance.pending.size === 0) {
            instance.worker.unref();
          }
        };
        const entry: PendingExec = {
          calls: new Map(),
          inContext: AsyncLocalStorage.snapshot(),
          invokeTool,
          mainBashFactory,
          reject: (error) => {
            settle();
            reject(error);
          },
          resolve: (result) => {
            settle();
            resolve(result);
          },
          signal,
          sink,
          sinkDone: Promise.resolve(),
        };
        instance.pending.set(id, entry);
        // A worker with nothing in flight must not hold the process open, and
        // one with a call in flight must: an awaited result is not a handle.
        instance.worker.ref();
        try {
          const ref = resolveRecord(options.taskId);
          instance.post({
            bashEnv: omit(options, ["remainingYieldMs"]),
            command,
            config: pick(getWorkspaceConfig(), WORKER_CONFIG_KEYS),
            execOptions,
            id,
            record: ref.isOk()
              ? { dir: dirOf(ref.value), ref: ref.value }
              : undefined,
            stream: sink !== undefined,
            type: "exec",
          });
        } catch (error) {
          // A value structured clone refuses (a function, say) never reached
          // the worker, so nothing there will answer for this id.
          entry.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
        }
      }),
  };
}

export function setBashWorkerFactory(next: BashWorkerFactory): void {
  factory = next;
}

/**
 * Starts the worker ahead of the first command when it is enabled, so its
 * module load happens while the app boots rather than in front of a tool call.
 */
export function warmBashWorker(): void {
  if (bashWorkerEnabled()) {
    getInstance();
  }
}

function getInstance(): WorkerInstance {
  if (current) {
    return current;
  }
  if (!factory) {
    throw new Error(
      "The bash worker is enabled but no worker factory was set (setBashWorkerFactory).",
    );
  }
  const worker = factory({ name: "bash" });
  const instance: WorkerInstance = {
    pending: new Map(),
    post: (message) => {
      worker.postMessage(message);
    },
    retired: false,
    trees: new Set(),
    worker,
  };
  worker.unref();
  worker.on("message", (message: FromWorker) => {
    void onMessage(instance, message);
  });
  worker.on("error", (error: Error) => {
    retire(
      instance,
      new Error(`The bash worker crashed: ${error.message}`, { cause: error }),
    );
  });
  worker.on("exit", (code) => {
    retire(instance, new Error(`The bash worker exited with code ${code}.`));
  });
  current = instance;
  return instance;
}

async function onMessage(instance: WorkerInstance, message: FromWorker) {
  switch (message.type) {
    case "call": {
      await runProxiedCall(instance, message);
      return;
    }
    case "call-abort": {
      for (const entry of instance.pending.values()) {
        entry.calls.get(message.callId)?.abort();
      }
      return;
    }
    case "capture-exception": {
      getWorkspaceConfig().captureException(
        fromWireError(message.error),
        message.properties,
      );
      return;
    }
    case "chunk": {
      const entry = instance.pending.get(message.id);
      if (entry?.sink) {
        const { sink } = entry;
        entry.sinkDone = entry.sinkDone
          .then(() => sink(message.text))
          .catch((error: unknown) => {
            getWorkspaceConfig().captureException(error);
          });
      }
      // Acknowledged once delivered, which is what holds a chatty process
      // back: the worker's sink waits for this before reading more output.
      await entry?.sinkDone;
      instance.post({ seq: message.seq, type: "chunk-ack" });
      return;
    }
    case "error": {
      const entry = instance.pending.get(message.id);
      if (entry) {
        await entry.sinkDone;
        entry.reject(fromWireError(message.error));
      }
      return;
    }
    case "result": {
      const entry = instance.pending.get(message.id);
      if (entry) {
        // Every chunk the worker sent before its result reaches the sink first,
        // so the streamed copy is whole by the time the run settles.
        await entry.sinkDone;
        entry.resolve(message.result);
      }
      return;
    }
    case "skill-mutation": {
      instance.pending.get(message.id)?.inContext(() => {
        recordWorkspaceSkillMutation(message.mountPath);
      });
      return;
    }
    case "tool": {
      await runProxiedTool(instance, message);
      return;
    }
    case "tree": {
      if (message.state === "started") {
        instance.trees.add(message.pid);
      } else {
        instance.trees.delete(message.pid);
      }
      return;
    }
    case "venv": {
      const result = await ensureTaskVenvForTask({ taskId: message.taskId });
      instance.post({
        requestId: message.requestId,
        result,
        type: "venv-result",
      });
      return;
    }
  }
}

/**
 * Settles everything a dead worker owed: its execs fail, the commands it had
 * proxied here stop, and the process trees it started are ended, since nothing
 * on its side is left to do it.
 */
function retire(instance: WorkerInstance, error: Error) {
  if (current === instance) {
    current = undefined;
  }
  if (instance.retired) {
    return;
  }
  instance.retired = true;
  getWorkspaceConfig().captureException(error);
  for (const entry of instance.pending.values()) {
    for (const call of entry.calls.values()) {
      call.abort();
    }
    entry.reject(error);
  }
  for (const pid of instance.trees) {
    void terminateSubprocessTree(pid);
  }
  instance.trees.clear();
}

/**
 * Runs one main-thread command for the worker, as a one-word script with the
 * worker's argv, cwd, environment and stdin, in a shell built here from the same
 * options, so it gets a context and filesystem of the same shape it would have
 * had in the worker.
 */
async function runProxiedCall(
  instance: WorkerInstance,
  message: Extract<FromWorker, { type: "call" }>,
) {
  const entry = instance.pending.get(message.id);
  if (!entry) {
    instance.post({
      callId: message.callId,
      error: toWireError(
        new Error(
          `${message.name}: the shell that ran this has already finished`,
        ),
      ),
      type: "call-error",
    });
    return;
  }
  const controller = new AbortController();
  entry.calls.set(message.callId, controller);
  try {
    entry.mainBash ??= entry.mainBashFactory();
    const bash = await entry.mainBash;
    const result = await entry.inContext(() =>
      bash.exec(message.name, {
        args: message.args,
        cwd: message.cwd,
        env: message.env,
        replaceEnv: true,
        signal: entry.signal
          ? AbortSignal.any([controller.signal, entry.signal])
          : controller.signal,
        stdin: message.stdin,
        stdinKind: "bytes",
      }),
    );
    instance.post({
      callId: message.callId,
      result: toWireResult(result),
      type: "call-result",
    });
  } catch (error) {
    instance.post({
      callId: message.callId,
      error: toWireError(error),
      type: "call-error",
    });
  } finally {
    entry.calls.delete(message.callId);
  }
}

/** Makes one `js-exec` app tool call for the worker, in the exec's async context. */
async function runProxiedTool(
  instance: WorkerInstance,
  message: Extract<FromWorker, { type: "tool" }>,
) {
  const entry = instance.pending.get(message.id);
  // In `calls` beside the proxied commands, so the worker's `call-abort`
  // and a dying worker stop it the same way.
  const controller = new AbortController();
  entry?.calls.set(message.callId, controller);
  try {
    if (!entry) {
      throw new Error(
        `tools.${message.path}: the shell that ran this has already finished`,
      );
    }
    const signal = entry.signal
      ? AbortSignal.any([controller.signal, entry.signal])
      : controller.signal;
    const value = await entry.inContext(() =>
      entry.invokeTool(message.path, message.argsJson, signal),
    );
    instance.post({ callId: message.callId, type: "tool-result", value });
  } catch (error) {
    instance.post({
      callId: message.callId,
      error: toWireError(error),
      type: "tool-error",
    });
  } finally {
    entry?.calls.delete(message.callId);
  }
}
