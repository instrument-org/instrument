import { existsSync } from "node:fs";
import path from "node:path";

import {
  getWorkspaceConfig,
  hasWorkspaceConfig,
  setWorkspaceConfig,
} from "../workspace-config";
import {
  bwrapAvailable,
  bwrapCommand,
  bwrapInstalled,
  bwrapState,
} from "./bwrap";
import { type MxcCommand, mxcLaunch, mxcPolicyFor, mxcState } from "./mxc";
import { recordProgramStart } from "../shell-commands/command-runs";
import { currentReach, type NativeReach } from "./reach";
import { seatbeltAvailable, seatbeltCommand, seatbeltState } from "./seatbelt";

export { bwrapArgs, bwrapAvailable } from "./bwrap";
export {
  mxcCanaryLaunch,
  mxcFilesystemPolicy,
  mxcRequest,
  windowsCommandLine,
} from "./mxc";
export {
  appNativeReach,
  heldNativeReach,
  type NativeReach,
  reachesSshKeys,
  withNativeReach,
} from "./reach";
export { packageScopeNote } from "./refusals";
export {
  seatbeltAvailable,
  seatbeltProfile,
  withInstallerClosed,
} from "./seatbelt";

/**
 * Why no system sandbox holds native commands here, by what the system
 * itself shows: no `sandbox-exec` on a Mac, no bubblewrap or user namespaces
 * closed on Linux, a probe that failed for a reason the settings do not
 * show, and Windows until MXC holds them. Undefined where a sandbox holds
 * them.
 */
export type SandboxOff =
  | "did-not-start"
  | "no-bubblewrap"
  | "no-seatbelt"
  | "user-namespaces-closed"
  | "windows";

let simulatedOff: SandboxOff | undefined;

/**
 * Reports the sandbox as off for this reason, or as it really is with
 * undefined, so the app's warnings can be seen on a computer whose sandbox
 * works. Changes only what is reported, never what holds a command.
 */
export function simulateSandboxOff(off: SandboxOff | undefined): void {
  simulatedOff = off;
}

/**
 * Records the person's choice to let native commands run with no sandbox on
 * this computer where none holds them, which every later command reads.
 */
export function allowProgramsWithoutSandbox(allowed: boolean): void {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    programsWithoutSandbox: allowed,
  });
}

export function nativeSandboxOff(): SandboxOff | undefined {
  if (simulatedOff) {
    return simulatedOff;
  }
  // Before the workspace starts nothing runs a command, and the probes read
  // its config.
  if (!hasWorkspaceConfig()) {
    return undefined;
  }
  const states = [seatbeltState(), bwrapState(), mxcState()];
  if (states.includes("works")) {
    return undefined;
  }
  if (states.includes("failed")) {
    return "did-not-start";
  }
  if (process.platform === "darwin") {
    return "no-seatbelt";
  }
  if (process.platform === "linux") {
    return bwrapInstalled() ? "user-namespaces-closed" : "no-bubblewrap";
  }
  return "windows";
}

/**
 * Whether a native command started now runs held to the rules: a reach
 * applies here and a system sandbox can hold it.
 */
export function nativeCommandsSandboxed(): boolean {
  return (
    currentReach() !== undefined &&
    (seatbeltAvailable() ||
      bwrapAvailable() ||
      (mxcState() === "works" && Boolean(getWorkspaceConfig().mxcExecPath)))
  );
}

/**
 * Thrown in place of running a command with no sandbox, where none holds
 * native commands here and the person has not chosen to run them without
 * one.
 */
export class NativeSandboxUnavailableError extends Error {
  constructor(file: string) {
    super(
      `${path.basename(file)} did not run: no sandbox holds programs to the permission settings on this computer, and Instrument runs none without one unless the person allows it. Settings › Permissions says why and has the switch; tell them, and don't look for another way to run it. The shell's own commands and your file tools still work.`,
    );
    this.name = "NativeSandboxUnavailableError";
  }
}

/**
 * A command as `wrapNativeCommand` left it: run as it is, held by Seatbelt
 * or bubblewrap in its arguments, or held by MXC, whose launcher's request
 * `launchNative` builds once the working folder and environment are known.
 */
export type WrappedCommand =
  | {
      args: string[];
      file: string;
      kind: "unwrapped";
      reach?: undefined;
      /**
       * The reach the rules give the command where no sandbox here holds it
       * to them, which still decides what it inherits from the app.
       */
      unheld?: NativeReach;
    }
  | { args: string[]; file: string; kind: "sandboxed"; reach: NativeReach }
  | (MxcCommand & { kind: "mxc"; reach: NativeReach });

/**
 * The command to spawn for a native binary, held to `reach` under Seatbelt,
 * bubblewrap or MXC. Where none can apply, the command comes back unwrapped.
 */
export function wrapNativeCommand(
  file: string,
  args: readonly string[],
  /** Null runs the command unwrapped, for an app the person allowed. */
  reach: NativeReach | null | undefined = currentReach(),
): WrappedCommand {
  const wrapped = wrap(file, args, reach);
  // A program a shell command starts is wrapped here, so this is where the
  // call's record learns what held it.
  recordProgramStart(
    file,
    reach === null
      ? "skipped"
      : wrapped.kind === "unwrapped"
        ? "none"
        : wrapped.kind === "mxc"
          ? "mxc"
          : process.platform === "darwin"
            ? "seatbelt"
            : "bwrap",
  );
  return wrapped;
}

function wrap(
  file: string,
  args: readonly string[],
  reach: NativeReach | null | undefined,
): WrappedCommand {
  const unwrapped: WrappedCommand = {
    args: [...args],
    file,
    kind: "unwrapped",
    unheld: reach ?? undefined,
  };
  // A binary that is not there is left to fail as itself, so the shim's
  // not-found diagnostic names it rather than sandbox-exec's execvp error.
  if (!reach || (path.isAbsolute(file) && !existsSync(file))) {
    return unwrapped;
  }
  const seatbelt = seatbeltState();
  if (seatbelt === "works") {
    return { ...seatbeltCommand(reach, file, args), kind: "sandboxed", reach };
  }
  const bwrap = bwrapState();
  const mxc = mxcState();
  const failed =
    seatbelt === "failed" || bwrap === "failed" || mxc === "failed";
  // No sandbox holds it: it runs only where the person chose that, and on
  // Windows, which Settings says has none until MXC can hold it.
  const runsAnyway =
    getWorkspaceConfig().programsWithoutSandbox === true ||
    (process.platform === "win32" && !failed);
  if (failed && !runsAnyway) {
    throw new NativeSandboxUnavailableError(file);
  }
  const mxcExec = getWorkspaceConfig().mxcExecPath;
  if (mxc === "works" && mxcExec) {
    return {
      argv: [file, ...args],
      file: mxcExec,
      filesystem: mxcPolicyFor(reach),
      kind: "mxc",
      reach,
    };
  }
  if (bwrap === "works") {
    return { ...bwrapCommand(reach, file, args), kind: "sandboxed", reach };
  }
  if (!runsAnyway) {
    throw new NativeSandboxUnavailableError(file);
  }
  return unwrapped;
}

/**
 * The program and arguments to spawn for what `wrapNativeCommand` returned:
 * for a command held under MXC, the launcher with its request, built now
 * that the working folder and environment are known. Every caller that
 * spawns what `wrapNativeCommand` returned goes through this.
 */
export function launchNative(
  spawned: WrappedCommand,
  context: {
    cwd?: string;
    env: Record<string, string | undefined>;
    /** The environment holds a secret: see `mxcLaunch`. */
    privateRequest?: true;
    windowsVerbatimArguments?: boolean;
  },
): { args: string[]; file: string; request?: string } {
  return spawned.kind === "mxc"
    ? mxcLaunch(spawned, context)
    : { args: spawned.args, file: spawned.file };
}
