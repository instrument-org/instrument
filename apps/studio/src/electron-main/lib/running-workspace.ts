import {
  type DeviceId,
  type WorkspaceActorRef,
  type WorkspaceConfig,
} from "@instrument-org/workspace/electron";

/**
 * The workspace this process runs: its actor and config, the device its
 * records are written as, and how it closes, for a process that goes on to
 * open another.
 */
export interface RunningWorkspace {
  actor: WorkspaceActorRef;
  close: () => Promise<void>;
  deviceId: DeviceId;
  workspaceConfig: WorkspaceConfig;
}

let running: RunningWorkspace | undefined;

/**
 * The workspace running now, for what reaches it from outside a request (the
 * RPC handshake, the quit, the notifications). None before boot has started
 * one, and none while a switch has closed one and not yet opened the next.
 */
export function runningWorkspace(): RunningWorkspace | undefined {
  return running;
}

export function setRunningWorkspace(next: RunningWorkspace | undefined): void {
  running = next;
}

let settling: Promise<void> = Promise.resolve();

/**
 * Settles once no switch of workspace is under way: what the quit waits on
 * before it reads the running workspace, so it never tears one down
 * alongside a switch closing it.
 */
export function workspaceSwitchSettled(): Promise<void> {
  return settling;
}

/** Marks a switch under way until `switched` settles. */
export function noteWorkspaceSwitch(switched: Promise<void>): void {
  settling = switched.catch(() => undefined);
}
