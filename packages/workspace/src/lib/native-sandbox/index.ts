import { existsSync } from "node:fs";
import path from "node:path";

import { getWorkspaceConfig } from "../workspace-config";
import { bwrapAvailable, bwrapCommand, bwrapState } from "./bwrap";
import { type MxcCommand, mxcLaunch, mxcPolicyFor, mxcState } from "./mxc";
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
 * Whether native commands run under a system sandbox here, or would once a
 * probe that gave no answer gets one; false only where the system said none
 * can be made.
 */
export function nativeSandboxEnforced(): boolean {
  return (
    seatbeltState() !== "unavailable" ||
    bwrapState() !== "unavailable" ||
    mxcState() !== "unavailable"
  );
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
 * Thrown in place of running a command with no sandbox when the one this
 * computer has did not start.
 */
export class NativeSandboxUnavailableError extends Error {
  constructor(file: string) {
    super(
      `${path.basename(file)} did not run: the sandbox that holds commands to the permission settings did not start, and Instrument does not run a command without it. Run the command again in a moment.`,
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
  if (seatbelt === "failed" || bwrap === "failed" || mxc === "failed") {
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
    windowsVerbatimArguments?: boolean;
  },
): { args: string[]; file: string } {
  return spawned.kind === "mxc"
    ? mxcLaunch(spawned, context)
    : { args: spawned.args, file: spawned.file };
}
