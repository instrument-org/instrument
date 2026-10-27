import { type CaptureContext } from "@instrument-org/shared";
import {
  type SerializedError,
  serializeError,
} from "@instrument-org/shared/exceptions";
import { type BashExecResult, type ExecOptions } from "just-bash";

import { type AbsolutePath, type ChatDir } from "../../schemas/paths";
import { type ChatId } from "../../schemas/chat-id";
import { type WorkspaceConfig } from "../../types";
import {
  type ChannelReply,
  type ChannelRequest,
} from "../capabilities/channel";
import { type BashEnvOptions } from "../create-bash-env";
import { type Asker } from "../chat/asks";
import { type SetupTouch } from "../setup-changes";
import { type CommandRun } from "../shell-commands/command-runs";
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
  // The person's choice to run programs where no sandbox holds them.
  "programsWithoutSandbox",
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
      context?: CaptureContext;
      error: SerializedError;
      type: "capture-exception";
    }
  | { id: number; touch: SetupTouch; type: "setup-touch" }
  /**
   * A command's look into `root` that waits, which the main thread watches
   * for macOS's prompt about it until the matching unwatch.
   */
  | { asker: Asker; id: string; root: string; type: "macos-watch" }
  | { id: string; type: "macos-unwatch" }
  /** Programs Windows' ransomware protection kept out of `folder`, which the chat's card says. */
  | {
      asker: Asker;
      folder: string;
      programs: string[];
      type: "windows-protection-block";
    }
  /** What a read or listing learned of macOS's answer for a folder, for Settings. */
  | {
      answer: "allowed" | "denied";
      hostPath: string;
      type: "macos-folder-answer";
    }
  | { id: number; result: WireResult; type: "result" }
  /**
   * What answered each command so far, whole: sent when a run adds a row,
   * and once more before the exec's result or error.
   */
  | { id: number; rows: CommandRun[]; type: "ran" }
  | { id: number; seq: number; text: string; type: "chunk" }
  | {
      /** The exec that started it, whose run on main is told its pid. */
      id: number | undefined;
      pid: number;
      state: "settled" | "started";
      type: "tree";
    }
  /** What a script's `instrument` asks, answered on main where app credentials are. */
  | { callId: number; id: number; request: ChannelRequest; type: "capability" }
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
      /** Main's PATH as the command starts, which the login shell's read may have changed since the worker started. */
      path: string | undefined;
      /** Whether main has a background run's sink to stream native output into. */
      stream: boolean;
      type: "exec";
    }
  | { callId: number; error: WireError; type: "call-error" }
  | { callId: number; result: WireResult; type: "call-result" }
  | { id: number; type: "abort" }
  | { callId: number; reply: ChannelReply; type: "capability-reply" }
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
 * An error as it crosses the thread boundary: the shape a captured
 * exception is built from, so its own properties, its cause and an
 * AggregateError's errors survive. Structured clone keeps a custom error's
 * message but not its class, name or own properties, and callers tell some
 * apart with `instanceof`.
 */
export type WireError = SerializedError;

/** A command's result as it crosses the thread boundary, internal fields dropped. */
export type WireResult = Pick<
  BashExecResult,
  "env" | "exitCode" | "metadata" | "stderr" | "stdout" | "stdoutKind"
>;

export type WorkerConfig = Pick<
  WorkspaceConfig,
  (typeof WORKER_CONFIG_KEYS)[number]
>;

/** The error a `WireError` was made from, as near as one can be rebuilt. */
export function fromWireError({
  data,
  links = [],
  stack,
  type,
  value,
}: WireError): Error {
  const cause = links.find((link) => link.source === "cause");
  const errors = links.filter((link) => link.source.startsWith("errors["));
  const error = new Error(
    value,
    cause ? { cause: fromWireError(cause.error) } : undefined,
  );
  if (type === SubprocessTreeTerminationError.name) {
    Object.setPrototypeOf(error, SubprocessTreeTerminationError.prototype);
  }
  Object.assign(error, data);
  if (errors.length > 0) {
    Object.assign(error, {
      errors: errors.map((link) => fromWireError(link.error)),
    });
  }
  error.name = type;
  error.stack = stack;
  return error;
}

export function toWireError(error: unknown): WireError {
  return serializeError(error);
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
