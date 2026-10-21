import {
  answeredStep,
  finishedRecord,
  isEveryStepAnswered,
  setupStateFrom,
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

function readRecord(): SetupRecord {
  return getMachineState().get("setup");
}

function changed() {
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

/** Whether setup is up, without reading the facts once every step is answered. */
export function isSetupUp(): boolean {
  if (isSkipped() || isEveryStepAnswered(readRecord())) {
    return false;
  }
  return readSetupState().step !== null;
}

/** Records a step as answered, so setup moves past it for good. */
export function answerSetupStep(step: SetupStep): void {
  getMachineState().set("setup", answeredStep(readRecord(), step, new Date()));
  changed();
}

/** Records setup as finished, with every step this build knows answered. */
export function finishSetup(): void {
  getMachineState().set("setup", finishedRecord(readRecord(), new Date()));
  changed();
}

/** Forgets every answer, so setup runs again as though it never had. */
export function resetSetup(): void {
  getMachineState().set("setup", { answered: {} });
  changed();
}
