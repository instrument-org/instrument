import {
  answeredByPlacing,
  answeredStep,
  finishedRecord,
  isEveryStepAnswered,
  setupStateFrom,
  unansweredStep,
} from "@/electron-main/lib/setup-step";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  DEFAULT_WORKSPACE_ID,
  getLocalWorkspace,
  isWorkspacePlaced,
} from "@/electron-main/lib/workspaces";
import { getMachineState } from "@/electron-main/stores/machine/state";
import {
  readSetupRecord,
  writeSetupRecord,
} from "@/electron-main/stores/workspace/state";
import {
  type SetupFacts,
  type SetupRecord,
  type SetupState,
  type SetupStep,
} from "@/shared/setup";

/**
 * Where setup's facts come from (`setup-facts.ts`), which reaches every
 * account and store. It hands itself in rather than being imported, so
 * the windows and menus that ask `isSetupUp` don't depend on all of that.
 */
interface SetupFactsSource {
  read: () => SetupFacts;
  /** Settles once the slow facts are read, or their deadline passes. */
  settle: () => Promise<void>;
}

let source: SetupFactsSource | undefined;

export function provideSetupFacts(provided: SetupFactsSource): void {
  source = provided;
}

function facts(): SetupFactsSource {
  if (!source) {
    throw new Error("Setup was read before its facts were provided");
  }
  return source;
}

function isSkipped() {
  return process.env.SKIP_ONBOARDING === "true";
}

// Held in memory, since the window asks on every key press and the store
// reads its file on every get. Only this module writes it.
let record: SetupRecord | undefined;

/**
 * Setup's record, kept per workspace in its machine folder. The default
 * workspace first takes in the record earlier builds kept once for the whole
 * computer, which is then removed, so a computer that finished setup on one
 * of them doesn't run it again.
 */
function readRecord(): SetupRecord {
  record ??= carryMachineRecord() ?? readSetupRecord();
  return record;
}

function carryMachineRecord(): SetupRecord | undefined {
  if (getLocalWorkspace().id !== DEFAULT_WORKSPACE_ID) {
    return undefined;
  }
  const machine = getMachineState();
  const carried = machine.get("setup");
  if (carried === undefined) {
    return undefined;
  }
  const own = readSetupRecord();
  const kept =
    own.finishedAt === undefined && Object.keys(own.answered).length === 0
      ? carried
      : own;
  writeSetupRecord(kept);
  machine.delete("setup");
  return kept;
}

function writeRecord(next: SetupRecord) {
  record = next;
  writeSetupRecord(next);
  publisher.publish("setup.updated", null);
}

/**
 * Settles once setup's state can be trusted: the slow facts (Claude's
 * status from Claude Code, the billing status, the notification status)
 * read, or their deadline passed. Boot waits on this before it decides
 * whether setup is up, so the window opens the right size. Someone who
 * answered every step never waits, since no fact can bring setup back for
 * them.
 */
export async function setupStateKnown(): Promise<void> {
  const settling = facts().settle();
  if (isSkipped() || isAnsweredAndPlaced()) {
    return;
  }
  await settling;
}

/**
 * Every step answered, with a workspace to run: no fact can bring setup
 * back. A first launch has no workspace whatever the record says, and setup
 * places it.
 */
function isAnsweredAndPlaced() {
  return isWorkspacePlaced() && isEveryStepAnswered(readRecord());
}

/**
 * Where setup is: the step it's on, or none. Every reader in main (the
 * window's size, the menu, the chords, asks from outside) and the renderer's
 * `setup.live.state` go through this. Never waits: before
 * `setupStateKnown` settles, the slow facts read as not known.
 */
export function readSetupState(): SetupState {
  return setupStateFrom({
    facts: facts().read(),
    record: readRecord(),
    skip: isSkipped(),
  });
}

/**
 * Whether setup can still ask anything a fact decides: it is not hidden and
 * has never finished. After finishing, only a missing answer brings it back.
 */
export function setupStillAsks(): boolean {
  return !isSkipped() && readRecord().finishedAt === undefined;
}

/** Whether setup is up, without reading the facts once every step is answered. */
export function isSetupUp(): boolean {
  if (isSkipped() || isAnsweredAndPlaced()) {
    return false;
  }
  return readSetupState().step !== null;
}

/** Records a step as answered, so setup moves past it for good. */
export function answerSetupStep(step: SetupStep): void {
  writeRecord(answeredStep(readRecord(), step, new Date()));
}

/**
 * Records the folder step as answered by the workspace it placed, with
 * Welcome back answered too, so setup goes on to the step after the folder.
 */
export function answerSetupByPlacing(): void {
  writeRecord(answeredByPlacing(readRecord(), new Date()));
}

/**
 * Goes back from the step setup is on to the one before it, by forgetting
 * that step's answer. Nothing happens when setup has moved on from `from`
 * already, or has nothing to go back to.
 */
export function backFromSetupStep(from: SetupStep): void {
  const state = readSetupState();
  if (state.step !== from || state.back === null) {
    return;
  }
  writeRecord(unansweredStep(readRecord(), state.back));
}

/** Records setup as finished, with every step this build knows answered. */
export function finishSetup(): void {
  writeRecord(finishedRecord(readRecord(), new Date()));
}

/** Forgets every answer, so setup runs again as though it never had. */
export function resetSetup(): void {
  writeRecord({ answered: {} });
}
