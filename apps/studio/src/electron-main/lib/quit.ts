import { type Actor, createActor, waitFor } from "xstate";

import { quitMachine } from "./quit-machine";

let quit: Actor<typeof quitMachine> | null = null;
let forcedInDev = false;

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
 * What `before-quit` reports: approval if it is still needed, then the
 * teardown that ends in `app.exit`. Repeats while either runs are ignored.
 */
export function requestQuit() {
  quit?.send({ type: "quitRequested" });
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
export function startQuit(machine: typeof quitMachine) {
  quit = createActor(machine).start();
}
