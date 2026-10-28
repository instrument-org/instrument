import { type Actor, createActor, waitFor } from "xstate";

import { quitMachine } from "./quit-machine";

let quit: Actor<typeof quitMachine> | null = null;
let forcedInDev = false;
let countRunningWork: (() => Promise<RunningWork>) | undefined;

/** What quitting now would stop. */
export type RunningWork = {
  agents: number;
  dictating: boolean;
  jobs: number;
};

/**
 * Whether closing the last window quits the app. On macOS the app stays in
 * the Dock, its agents and their jobs keep working, and the Dock icon brings
 * a window back; Cmd+Q is the quit. Elsewhere a process with no window has
 * nothing to come back from, so the last close is the quit.
 */
export const quitsWithLastWindow = process.platform !== "darwin";

/** True once this quit is approved; no further prompt is needed. */
export function isQuitApproved() {
  return quit?.getSnapshot().hasTag("approved") ?? false;
}

/** Whether the dev build should run the prompt it normally skips. */
export function isQuitGuardForcedInDev() {
  return forcedInDev;
}

/**
 * Asks about running agents unless this quit is already approved, sharing a
 * prompt that is already open. Resolves to whether the quit may go ahead.
 * Before boot has started the quit there is nothing to ask about.
 */
export async function requestQuitApproval(): Promise<boolean> {
  if (!quit) {
    return true;
  }
  quit.send({ type: "approvalRequested" });
  const settled = await waitFor(quit, (state) => !state.matches("approving"));
  return settled.hasTag("approved");
}

/**
 * Approves the quit without asking, for a quit whose caller has checked that
 * it stops nothing. False when a prompt is already open or the quit is
 * already under way, which leave the decision where it is.
 */
export function approveQuitQuietly(): boolean {
  if (!quit?.getSnapshot().matches("idle")) {
    return false;
  }
  quit.send({ type: "approvalGranted" });
  return isQuitApproved();
}

/**
 * Whether quitting now would stop anything: `unknown` before the workspace
 * starts or when the count fails, which a caller that must not interrupt
 * anything reads as busy.
 */
export async function readRunningWork(): Promise<"busy" | "idle" | "unknown"> {
  if (!countRunningWork) {
    return "unknown";
  }
  try {
    const work = await countRunningWork();
    return work.agents > 0 || work.jobs > 0 || work.dictating ? "busy" : "idle";
  } catch {
    return "unknown";
  }
}

/**
 * Takes back an approval whose quit is not going to happen, such as an
 * install that failed after the prompt approved the quit it would end in.
 * Does nothing once teardown has started.
 */
export function withdrawQuitApproval() {
  quit?.send({ type: "approvalWithdrawn" });
}

/**
 * What `before-quit` reports: approval if it is still needed, then the
 * teardown that ends in `app.exit`. Repeats while either runs are ignored.
 */
export function requestQuit() {
  quit?.send({ type: "quitRequested" });
}

/**
 * Reports a quit no one asked for in the app (`unattended-quit.ts`), which
 * tears down without asking. The `before-quit` that follows is a repeat.
 */
export function requestUnattendedQuit() {
  quit?.send({ type: "unattendedQuitRequested" });
}

/**
 * Opt a dev build back into the running-agent prompt, which it otherwise skips
 * so hot reload is never blocked on a dialog nobody sees. In memory only, so a
 * relaunch drops it and a forgotten toggle cannot strand a later rebuild.
 */
export function setQuitGuardForcedInDev(forced: boolean) {
  forcedInDev = forced;
}

/**
 * Start the quit with this app's prompt and teardown steps. Called once during
 * boot, before any window exists, so every close and quit path reaches it.
 */
export function startQuit(
  machine: typeof quitMachine,
  { runningWork }: { runningWork: () => Promise<RunningWork> },
) {
  quit = createActor(machine).start();
  countRunningWork = runningWork;
}
