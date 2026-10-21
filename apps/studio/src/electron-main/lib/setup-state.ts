import {
  answeredStep,
  finishedRecord,
  isEveryStepAnswered,
  setupStateFrom,
  unansweredStep,
} from "@/electron-main/lib/setup-step";
import { publisher } from "@/electron-main/rpc/publisher";
import { getMachineState } from "@/electron-main/stores/machine/state";
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

function readRecord(): SetupRecord {
  record ??= getMachineState().get("setup");
  return record;
}

function writeRecord(next: SetupRecord) {
  record = next;
  getMachineState().set("setup", next);
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
  if (isSkipped() || isEveryStepAnswered(readRecord())) {
    return;
  }
  await settling;
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
  if (isSkipped() || isEveryStepAnswered(readRecord())) {
    return false;
  }
  return readSetupState().step !== null;
}

/** Records a step as answered, so setup moves past it for good. */
export function answerSetupStep(step: SetupStep): void {
  writeRecord(answeredStep(readRecord(), step, new Date()));
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
