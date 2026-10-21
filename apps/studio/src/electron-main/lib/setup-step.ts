import {
  type SetupFacts,
  type SetupRecord,
  type SetupState,
  SETUP_STEPS,
  type SetupStep,
} from "@/shared/setup";

/**
 * When each step has something to ask, by the facts and the record. A step
 * a person can't do here (the plan without an Instrument account,
 * notifications off macOS) is never needed, so it is skipped rather than
 * shown.
 */
const NEEDED: Record<
  SetupStep,
  (facts: SetupFacts, record: SetupRecord) => boolean
> = {
  "free-account": (facts) => facts.hasUsableAI && !facts.hasInstrumentAccount,
  folder: (facts) => !facts.folderSettled,
  look: () => true,
  model: () => true,
  notifications: (facts) => facts.notificationsAskable,
  plan: (facts) => facts.hasInstrumentAccount && !facts.hasInstrumentPlan,
  "way-in": (facts) => !facts.hasUsableAI,
  "welcome-back": (facts, record) =>
    facts.usedBefore && record.finishedAt === undefined,
};

/**
 * The step setup is on: the first one that is needed and not answered, or
 * none. Before finishing, a fact settles a step as surely as an answer
 * does. Finishing answers every step, so afterwards only a step a later
 * build added can come up, and a fact that turns (signing out of every AI,
 * the folder back in app data) never reopens setup.
 */
export function currentSetupStep(
  facts: SetupFacts,
  record: SetupRecord,
): null | SetupStep {
  return (
    SETUP_STEPS.find(
      (step) =>
        record.answered[step] === undefined && NEEDED[step](facts, record),
    ) ?? null
  );
}

/** Setup is back after finishing, for only the steps added since. */
export function isNewStepOnly(facts: SetupFacts, record: SetupRecord): boolean {
  return (
    record.finishedAt !== undefined && currentSetupStep(facts, record) !== null
  );
}

/** Whether every step this build knows is answered, so no fact can bring setup up. */
export function isEveryStepAnswered(record: SetupRecord): boolean {
  return SETUP_STEPS.every((step) => record.answered[step] !== undefined);
}

export function answeredStep(
  record: SetupRecord,
  step: SetupStep,
  at: Date,
): SetupRecord {
  return {
    ...record,
    answered: { ...record.answered, [step]: at.toISOString() },
  };
}

/** Every step not answered yet is answered as of finishing. */
export function finishedRecord(record: SetupRecord, at: Date): SetupRecord {
  const time = at.toISOString();
  return {
    answered: {
      ...Object.fromEntries(SETUP_STEPS.map((step) => [step, time])),
      ...record.answered,
    },
    finishedAt: record.finishedAt ?? time,
  };
}

/**
 * Setup's state from its facts and record. `skip` (`SKIP_ONBOARDING`) hides
 * setup without writing anything, for fixtures and smoke tests.
 */
export function setupStateFrom({
  facts,
  record,
  skip,
}: {
  facts: SetupFacts;
  record: SetupRecord;
  skip: boolean;
}): SetupState {
  if (skip) {
    return { facts, isNewStepOnly: false, step: null };
  }
  return {
    facts,
    isNewStepOnly: isNewStepOnly(facts, record),
    step: currentSetupStep(facts, record),
  };
}
