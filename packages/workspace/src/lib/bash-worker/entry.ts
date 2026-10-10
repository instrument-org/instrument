/**
 * The bash worker: runs the just-bash interpreter, its filesystem and every
 * command that only does host work, off the thread that paints the window. See
 * `client.ts` for the main-thread half.
 */
import { defineCommand, latin1FromBytes } from "just-bash";
import { AsyncLocalStorage } from "node:async_hooks";
import { parentPort } from "node:worker_threads";

import { setWorkspaceServerPort } from "../../logic/server/url";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceConfig } from "../../types";
import { createLocalBashEnv } from "../create-bash-env";
import { setTaskVenvCreator, type TaskVenvError } from "../ensure-task-venv";
import { handChat } from "../record-folders";
import { withShellOutputSink } from "../shell-commands/output-sink";
import { setSubprocessTreeObserver } from "../subprocess-tree";
import { setWorkspaceConfig } from "../workspace-config";
import { setSkillMutationForwarder } from "../workspace-skill-index";
import {
  type ExceptionProperties,
  fromWireError,
  type FromWorker,
  toWireError,
  toWireResult,
  type ToWorker,
  type WireResult,
  WORKER_CONFIG_KEYS,
  type WorkerConfig,
} from "./protocol";

const port = parentPort;
if (!port) {
  throw new Error("The bash worker entry must run in a worker thread.");
}

const runs = new Map<number, AbortController>();
const calls = new Map<
  number,
  { reject: (error: Error) => void; resolve: (result: WireResult) => void }
>();
const toolCalls = new Map<
  number,
  { reject: (error: Error) => void; resolve: (value: string) => void }
>();
const chunkAcks = new Map<number, () => void>();
const venvRequests = new Map<
  number,
  (result: TaskVenvError | undefined) => void
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
  captureException(error, { origin: "uncaughtException" });
});
process.on("unhandledRejection", (reason) => {
  captureException(reason, { origin: "unhandledRejection" });
});

// State the main thread owns: which turn a skill write belongs to, the process
// trees to end if this worker dies, and the one creator of each task's venv.
setSkillMutationForwarder((mountPath) => {
  const id = currentExec.getStore();
  if (id !== undefined) {
    post({ id, mountPath, type: "skill-mutation" });
  }
});
setSubprocessTreeObserver({
  settled: (pid) => {
    post({ pid, state: "settled", type: "tree" });
  },
  started: (pid) => {
    post({ pid, state: "started", type: "tree" });
  },
});
setTaskVenvCreator(
  (chatId: ChatId) =>
    new Promise((resolve) => {
      const requestId = nextVenvRequestId++;
      venvRequests.set(requestId, resolve);
      post({ requestId, chatId, type: "venv" });
    }),
);

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
    case "tool-error": {
      toolCalls.get(message.callId)?.reject(fromWireError(message.error));
      toolCalls.delete(message.callId);
      return;
    }
    case "tool-result": {
      toolCalls.get(message.callId)?.resolve(message.value);
      toolCalls.delete(message.callId);
      return;
    }
    case "venv-result": {
      venvRequests.get(message.requestId)?.(message.result);
      venvRequests.delete(message.requestId);
      return;
    }
  }
});

function captureException(error: unknown, properties?: ExceptionProperties) {
  post({ error: toWireError(error), properties, type: "capture-exception" });
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
  stream,
  workspaceServerPort,
}: Extract<ToWorker, { type: "exec" }>) {
  const controller = new AbortController();
  runs.set(id, controller);
  // One config per process on main, so the latest snapshot is the only one.
  setWorkspaceConfig(workerConfig(config));
  setWorkspaceServerPort(workspaceServerPort);
  // Main keeps the folder index current as it makes and trashes chats, so
  // the chat comes resolved with the command rather than read here, where a
  // copy of the index would miss a chat made since.
  if (chat) {
    handChat(chat);
  }
  try {
    const bash = await createLocalBashEnv({
      ...bashEnv,
      invokeTool: (path, argsJson, signal) =>
        invokeTool({ argsJson, id, path, signal }),
      standIn: (name) => standIn(id, name),
    });
    const run = () =>
      bash.exec(command, { ...execOptions, signal: controller.signal });
    const result = await currentExec.run(id, () =>
      stream ? withShellOutputSink((text) => sendChunk(id, text), run) : run(),
    );
    post({ id, result: toWireResult(result), type: "result" });
  } catch (error) {
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
 * A `js-exec` script's app tool call, made on the main thread. An abort of the
 * script's signal stops it there, as it does a proxied command.
 */
function invokeTool({
  argsJson,
  id,
  path,
  signal,
}: {
  argsJson: string;
  id: number;
  path: string;
  signal: AbortSignal | undefined;
}) {
  return new Promise<string>((resolve, reject) => {
    const callId = nextCallId++;
    const onAbort = () => {
      post({ callId, type: "call-abort" });
    };
    const settle = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    toolCalls.set(callId, {
      reject: (error) => {
        settle();
        reject(error);
      },
      resolve: (value) => {
        settle();
        resolve(value);
      },
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    post({ argsJson, callId, id, path, type: "tool" });
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
