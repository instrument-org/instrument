import { type CaptureExceptionFunction } from "@instrument-org/shared";
import { type BashExecResult, type ExecOptions } from "just-bash";

import { type AbsolutePath, type ChatDir } from "../../schemas/paths";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceConfig } from "../../types";
import { type BashEnvOptions } from "../create-bash-env";
import { type VenvError } from "../venv";
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
  // Where this computer's folder is, which the rules close.
  "userDataDir",
  // Where the folder rules are read from, live, for each command.
  "workspaceMachineDir",
  "macHelperBinPath",
  "seatbeltHelperPath",
  "mxcExecPath",
  "nativeSandbox",
  "nodeExecEnv",
  // Where finished work goes, which the shell names `INSTRUMENT_OUTPUT`.
  "outputDir",
  "pnpmBinPath",
  "registryDir",
  "rootDir",
  "runtimeDir",
  "systemSkillsDir",
  "legacyTasksDir",
  "tempFolders",
  "uutilsDir",
  "uutilsOutsideSandbox",
  "uvBinPath",
  // Where each chat's work folder is, which the shell starts in.
  "workFoldersDir",
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
  | { id: number; skillPath: string; type: "skill-mutation" }
  | { id: number; result: WireResult; type: "result" }
  | { id: number; seq: number; text: string; type: "chunk" }
  | {
      /** The exec that started it, whose run on main is told its pid. */
      id: number | undefined;
      pid: number;
      state: "settled" | "started";
      type: "tree";
    }
  /** A `node` script's `tools.<slug>.<tool>()`, made on main where app credentials are. */
  | { argsJson: string; callId: number; id: number; path: string; type: "tool" }
  | { chatId: ChatId; requestId: number; type: "venv"; venv: AbsolutePath }
  /** A skill's Python environment, built on main, which builds each one once. */
  | {
      chatId: ChatId;
      requestId: number;
      skillDir: AbsolutePath;
      type: "python-environment";
    }
  /** A due check of the base Python packages, which main runs. */
  | { type: "python-base-refresh" };

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
    }
  | { callId: number; error: WireError; type: "call-error" }
  | { callId: number; result: WireResult; type: "call-result" }
  | { id: number; type: "abort" }
  | { callId: number; error: WireError; type: "tool-error" }
  | { callId: number; type: "tool-result"; value: string }
  | {
      requestId: number;
      result: undefined | VenvError;
      type: "venv-result";
    }
  | {
      requestId: number;
      result: { error: VenvError } | { venv: AbsolutePath };
      type: "python-environment-result";
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
