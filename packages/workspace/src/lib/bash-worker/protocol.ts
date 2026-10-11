import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { type BashExecResult, type ExecOptions } from "just-bash";

import { type ChatDir } from "../../schemas/paths";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceConfig } from "../../types";
import { type BashEnvOptions } from "../create-bash-env";
import { type TaskVenvError } from "../ensure-task-venv";
import { SubprocessTreeTerminationError } from "../subprocess-tree";

/**
 * The part of the workspace config the worker gets: paths and plain values.
 * Everything else is a function or a live object on the main thread, and the
 * commands that need one run there (`MAIN_THREAD_COMMANDS`).
 */
export const WORKER_CONFIG_KEYS = [
  "appsDir",
  "appVersion",
  "chatsDir",
  "defaultTaskTemplateDir",
  "macHelperBinPath",
  "nodeExecEnv",
  "pnpmBinPath",
  "preparedSkillsDir",
  "registryDir",
  "rootDir",
  "systemSkillsDir",
  "legacyTasksDir",
  "uvBinPath",
  "uvDataDir",
] as const satisfies readonly (keyof WorkspaceConfig)[];

export type ExceptionProperties = Parameters<CaptureExceptionFunction>[1];

export type FromWorker =
  | {
      args: string[];
      callId: number;
      cwd: string;
      env: Record<string, string>;
      id: number;
      name: string;
      /** Latin1, one char per byte, as main passes it on with `stdinKind: "bytes"`. */
      stdin: string;
      type: "call";
    }
  | { callId: number; type: "call-abort" }
  | { error: WireError; id: number; type: "error" }
  | {
      error: WireError;
      properties?: ExceptionProperties;
      type: "capture-exception";
    }
  | { id: number; mountPath: string; type: "skill-mutation" }
  | { id: number; result: WireResult; type: "result" }
  | { id: number; seq: number; text: string; type: "chunk" }
  | { pid: number; state: "settled" | "started"; type: "tree" }
  /** A `js-exec` script's `tools.<slug>.<tool>()`, made on main where app credentials are. */
  | { argsJson: string; callId: number; id: number; path: string; type: "tool" }
  | { requestId: number; chatId: ChatId; type: "venv" };

export type ToWorker =
  | {
      /** The shell to build, less `remainingYieldMs`, which only `fg` reads, on main. */
      bashEnv: Omit<BashEnvOptions, "remainingYieldMs">;
      command: string;
      config: WorkerConfig;
      execOptions: Omit<ExecOptions, "signal">;
      id: number;
      /**
       * The chat the shell runs in, resolved on main, which keeps the
       * folder index: the worker answers for this chat alone and never
       * reads the index itself.
       */
      chat: { dir: ChatDir; id: ChatId } | undefined;
      /** Whether main has a background run's sink to stream native output into. */
      stream: boolean;
      type: "exec";
      /** The port main's workspace server bound, which the shell's fetch refuses. */
      workspaceServerPort: number;
    }
  | { callId: number; error: WireError; type: "call-error" }
  | { callId: number; result: WireResult; type: "call-result" }
  | { id: number; type: "abort" }
  | { callId: number; error: WireError; type: "tool-error" }
  | { callId: number; type: "tool-result"; value: string }
  | {
      requestId: number;
      result: TaskVenvError | undefined;
      type: "venv-result";
    }
  | { seq: number; type: "chunk-ack" };

/**
 * An error as it crosses the thread boundary. Structured clone keeps a custom
 * error's message but not its class or name, and callers tell some apart with
 * `instanceof`.
 */
export interface WireError {
  cause?: WireError;
  message: string;
  name: string;
  stack?: string;
}

/** A command's result as it crosses the thread boundary, internal fields dropped. */
export type WireResult = Pick<
  BashExecResult,
  "env" | "exitCode" | "metadata" | "stderr" | "stdout" | "stdoutKind"
>;

export type WorkerConfig = Pick<
  WorkspaceConfig,
  (typeof WORKER_CONFIG_KEYS)[number]
>;

const MAX_CAUSE_DEPTH = 5;

export function fromWireError({
  cause,
  message,
  name,
  stack,
}: WireError): Error {
  const error = new Error(
    message,
    cause ? { cause: fromWireError(cause) } : undefined,
  );
  if (name === SubprocessTreeTerminationError.name) {
    Object.setPrototypeOf(error, SubprocessTreeTerminationError.prototype);
  }
  error.name = name;
  error.stack = stack;
  return error;
}

export function toWireError(error: unknown, depth = 0): WireError {
  if (!(error instanceof Error)) {
    return { message: String(error), name: "Error" };
  }
  return {
    ...(error.cause !== undefined &&
      depth < MAX_CAUSE_DEPTH && {
        cause: toWireError(error.cause, depth + 1),
      }),
    message: error.message,
    name: error.name,
    stack: error.stack,
  };
}

export function toWireResult(result: BashExecResult): WireResult {
  return {
    env: result.env,
    exitCode: result.exitCode,
    metadata: result.metadata,
    stderr: result.stderr,
    stdout: result.stdout,
    stdoutKind: result.stdoutKind,
  };
}
