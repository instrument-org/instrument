/**
 * The bash worker: runs the just-bash interpreter, its filesystem and every
 * command that only does host work, off the thread that paints the window. See
 * `client.ts` for the main-thread half.
 */
import { type CaptureContext } from "@instrument-org/shared";
import { STACK_FRAME_LIMIT } from "@instrument-org/shared/exceptions";
import { defineCommand, latin1FromBytes } from "just-bash";
import { AsyncLocalStorage } from "node:async_hooks";
import { parentPort } from "node:worker_threads";

import { type WorkspaceConfig } from "../../types";
import {
  type ChannelReply,
  type ChannelRequest,
} from "../capabilities/channel";
import { createLocalBashEnv } from "../create-bash-env";
import { setVenvCreator, type VenvError } from "../venv";
import { setPythonEnvironmentBuilder } from "../skill-environments";
import { setPythonBaseRefresher } from "../python-base";
import { handChat } from "../record-folders";
import { CommandRuns, withCommandRuns } from "../shell-commands/command-runs";
import { withShellOutputSink } from "../shell-commands/output-sink";
import { setSubprocessTreeObserver } from "../subprocess-tree";
import { setWorkspaceConfig } from "../workspace-config";
import { setMacosForwarder } from "../permissions/macos";
import { setProtectionForwarder } from "../permissions/windows-protection";
import { setSetupTouchForwarder } from "../setup-changes";
import {
  fromWireError,
  type FromWorker,
  toWireError,
  toWireResult,
  type ToWorker,
  type WireResult,
  WORKER_CONFIG_KEYS,
  type WorkerConfig,
} from "./protocol";

// As many frames as the event the main process builds keeps.
Error.stackTraceLimit = STACK_FRAME_LIMIT;

const port = parentPort;
if (!port) {
  throw new Error("The bash worker entry must run in a worker thread.");
}

// A worker's copy of the environment matches names by case, even on Windows,
// which spells the search path `Path`. Every reader here asks for `PATH`, and
// without it a native command's PATH would hold only the app's own folders.
if (process.platform === "win32" && process.env.PATH === undefined) {
  const spelled = Object.keys(process.env).find(
    (name) => name.toUpperCase() === "PATH",
  );
  if (spelled) {
    process.env.PATH = process.env[spelled];
    delete process.env[spelled];
  }
}

const runs = new Map<number, AbortController>();
const calls = new Map<
  number,
  { reject: (error: Error) => void; resolve: (result: WireResult) => void }
>();
const capabilityCalls = new Map<number, (reply: ChannelReply) => void>();
const chunkAcks = new Map<number, () => void>();
const venvRequests = new Map<number, (result: undefined | VenvError) => void>();
const environmentRequests = new Map<
  number,
  (
    result: Extract<ToWorker, { type: "python-environment-result" }>["result"],
  ) => void
>();
let nextCallId = 0;
let nextChunkSeq = 0;
let nextVenvRequestId = 0;

/** The exec the calling code belongs to, for reports that name one. */
const currentExec = new AsyncLocalStorage<number>();

// Node ends a worker on an uncaught error, and this one is shared by every
// task's shell, so one stray throw would fail all of their commands at once.
// Report it the way the main process does and keep running.
process.on("uncaughtException", (error) => {
  captureException(error, { handled: false, mechanism: "uncaughtException" });
});
process.on("unhandledRejection", (reason) => {
  captureException(reason, {
    handled: false,
    mechanism: "unhandledRejection",
  });
});

// State the main thread owns: which turn a setup write belongs to, the process
// trees to end if this worker dies, and the one creator of every venv and
// skill environment.
setSetupTouchForwarder((touch) => {
  const id = currentExec.getStore();
  if (id !== undefined) {
    post({ id, touch, type: "setup-touch" });
  }
});
setMacosForwarder({
  folderAnswer: (hostPath, answer) => {
    post({ answer, hostPath, type: "macos-folder-answer" });
  },
  unwatch: (id) => {
    post({ id, type: "macos-unwatch" });
  },
  watch: (id, asker, root) => {
    post({ asker, id, root, type: "macos-watch" });
  },
});
setProtectionForwarder((asker, folder, programs) => {
  post({ asker, folder, programs, type: "windows-protection-block" });
});
setSubprocessTreeObserver({
  settled: (pid) => {
    post({ id: currentExec.getStore(), pid, state: "settled", type: "tree" });
  },
  started: (pid) => {
    post({ id: currentExec.getStore(), pid, state: "started", type: "tree" });
  },
});
setVenvCreator(
  (venv, chatId) =>
    new Promise((resolve) => {
      const requestId = nextVenvRequestId++;
      venvRequests.set(requestId, resolve);
      post({ chatId, requestId, type: "venv", venv });
    }),
);

setPythonEnvironmentBuilder(
  ({ chatId, skillDir }) =>
    new Promise((resolve) => {
      const requestId = nextVenvRequestId++;
      environmentRequests.set(requestId, resolve);
      post({ chatId, requestId, skillDir, type: "python-environment" });
    }),
);
setPythonBaseRefresher(() => {
  post({ type: "python-base-refresh" });
});

port.on("message", (message: ToWorker) => {
  switch (message.type) {
    case "abort": {
      runs.get(message.id)?.abort();
      return;
    }
    case "call-error": {
      calls.get(message.callId)?.reject(fromWireError(message.error));
      calls.delete(message.callId);
      return;
    }
    case "call-result": {
      calls.get(message.callId)?.resolve(message.result);
      calls.delete(message.callId);
      return;
    }
    case "chunk-ack": {
      chunkAcks.get(message.seq)?.();
      chunkAcks.delete(message.seq);
      return;
    }
    case "exec": {
      void runExec(message);
      return;
    }
    case "capability-reply": {
      capabilityCalls.get(message.callId)?.(message.reply);
      capabilityCalls.delete(message.callId);
      return;
    }
    case "venv-result": {
      venvRequests.get(message.requestId)?.(message.result);
      venvRequests.delete(message.requestId);
      return;
    }
    case "python-environment-result": {
      environmentRequests.get(message.requestId)?.(message.result);
      environmentRequests.delete(message.requestId);
      return;
    }
  }
});

function captureException(error: unknown, context?: CaptureContext) {
  post({ context, error: toWireError(error), type: "capture-exception" });
}

function post(message: FromWorker) {
  port?.postMessage(message);
}

async function runExec({
  bashEnv,
  command,
  config,
  execOptions,
  id,
  chat,
  path: searchPath,
  stream,
}: Extract<ToWorker, { type: "exec" }>) {
  const controller = new AbortController();
  runs.set(id, controller);
  // Sent as each new row appears, so a command that moves to the background
  // reports what it started before it finishes.
  const commandRuns: CommandRuns = new CommandRuns(() => {
    post({ id, rows: commandRuns.rows(), type: "ran" });
  });
  // One config per process on main, so the latest snapshot is the only one.
  setWorkspaceConfig(workerConfig(config));
  // A worker's environment is a copy taken when it started, which is during
  // boot, before the login shell's PATH reaches main.
  if (searchPath !== undefined) {
    process.env.PATH = searchPath;
  }
  // Main keeps the folder index current as it makes and trashes chats, so
  // the chat comes resolved with the command rather than read here, where a
  // copy of the index would miss a chat made since.
  if (chat) {
    handChat(chat);
  }
  try {
    const bash = await createLocalBashEnv({
      ...bashEnv,
      answerScript: (request, signal) => answerOnMain({ id, request, signal }),
      standIn: (name) => standIn(id, name),
    });
    const run = () =>
      withCommandRuns(commandRuns, () =>
        bash.exec(command, { ...execOptions, signal: controller.signal }),
      );
    const result = await currentExec.run(id, () =>
      stream ? withShellOutputSink((text) => sendChunk(id, text), run) : run(),
    );
    post({ id, rows: commandRuns.rows(), type: "ran" });
    post({ id, result: toWireResult(result), type: "result" });
  } catch (error) {
    post({ id, rows: commandRuns.rows(), type: "ran" });
    post({ error: toWireError(error), id, type: "error" });
  } finally {
    runs.delete(id);
  }
}

/** Resolves once main has delivered the chunk, so output waits on the sink. */
function sendChunk(id: number, text: string) {
  return new Promise<void>((resolve) => {
    const seq = nextChunkSeq++;
    chunkAcks.set(seq, resolve);
    post({ id, seq, text, type: "chunk" });
  });
}

/**
 * What a script's `instrument` asks, answered on the main thread. An abort
 * of the command's signal stops the call there, as it does a proxied command.
 */
function answerOnMain({
  id,
  request,
  signal,
}: {
  id: number;
  request: ChannelRequest;
  signal: AbortSignal | undefined;
}) {
  return new Promise<ChannelReply>((resolve) => {
    const callId = nextCallId++;
    const onAbort = () => {
      post({ callId, type: "call-abort" });
    };
    capabilityCalls.set(callId, (reply) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(reply);
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    post({ callId, id, request, type: "capability" });
  });
}

/** A command that runs on the main thread, with this call's argv, cwd, env and stdin. */
function standIn(id: number, name: string) {
  return defineCommand(
    name,
    (args, ctx) =>
      new Promise((resolve, reject) => {
        const callId = nextCallId++;
        const onAbort = () => {
          post({ callId, type: "call-abort" });
        };
        const settle = () => {
          ctx.signal?.removeEventListener("abort", onAbort);
        };
        calls.set(callId, {
          reject: (error) => {
            settle();
            reject(error);
          },
          resolve: (result) => {
            settle();
            resolve(result);
          },
        });
        ctx.signal?.addEventListener("abort", onAbort, { once: true });
        post({
          args,
          callId,
          cwd: ctx.cwd,
          env: Object.fromEntries(ctx.env),
          id,
          name,
          stdin: latin1FromBytes(ctx.stdin),
          type: "call",
        });
      }),
  );
}

function workerConfig(data: WorkerConfig): WorkspaceConfig {
  const available: Partial<WorkspaceConfig> = {
    ...data,
    captureException,
  };
  // `as`, because this is not a whole config: every other key is a function
  // or live object on the main thread, reached only by the commands proxied
  // there. A read that gets here anyway names the key instead of returning
  // undefined into code that assumes it is set. `then` reads as absent so the
  // config is not mistaken for a promise, and a key the worker is sent reads
  // as absent when it was, since an optional one left unset never arrives.
  const sent = new Set<string>(WORKER_CONFIG_KEYS);
  return new Proxy(available, {
    get(target, key): unknown {
      if (
        typeof key === "symbol" ||
        key === "then" ||
        key in target ||
        sent.has(key)
      ) {
        return Reflect.get(target, key);
      }
      throw new Error(
        `Workspace config "${key}" is not available in the bash worker.`,
      );
    },
  }) as WorkspaceConfig;
}
