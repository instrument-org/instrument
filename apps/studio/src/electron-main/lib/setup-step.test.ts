import {
  type SetupFacts,
  type SetupRecord,
  SetupRecordSchema,
  SETUP_STEPS,
} from "@/shared/setup";
import { describe, expect, it } from "vitest";

import {
  answeredByPlacing,
  answeredStep,
  currentSetupStep,
  finishedRecord,
  isEveryStepAnswered,
  isNewStepOnly,
  setupStateFrom,
  stepBefore,
  unansweredStep,
} from "./setup-step";

/**
 * A first launch on a Mac nobody has asked about notifications: no
 * workspace yet, so nothing in one.
 */
const NEW: SetupFacts = {
  folderSettled: false,
  hasInstrumentAccount: false,
  hasInstrumentPlan: false,
  hasOwnAI: false,
  hasUsableAI: false,
  hasWorkspace: false,
  isCheckingPlan: false,
  lostFolder: null,
  notificationsAskable: true,
  hasChats: false,
  testedBefore: false,
};

/** The same launch once the folder step placed the workspace in a picked folder. */
const PLACED: SetupFacts = { ...NEW, folderSettled: true, hasWorkspace: true };

const EMPTY: SetupRecord = { answered: {} };
const AT = new Date("2026-10-21T12:00:00.000Z");

function answered(...steps: (typeof SETUP_STEPS)[number][]): SetupRecord {
  return steps.reduce((record, step) => answeredStep(record, step, AT), EMPTY);
}

/**
 * Goes through setup the way a person would: at each step, `act` says what
 * answering it changes, and the walk records the step answered.
 */
function walk(
  start: SetupFacts,
  act: Partial<Record<(typeof SETUP_STEPS)[number], Partial<SetupFacts>>>,
  record = EMPTY,
) {
  const seen: string[] = [];
  let facts = start;
  let step = currentSetupStep(facts, record);
  while (step !== null && seen.length < 20) {
    seen.push(step);
    facts = { ...facts, ...act[step] };
    // `choose-ai` keeps no answer: connecting is what moves past it.
    if (step !== "choose-ai") {
      record = answeredStep(record, step, AT);
    }
    step = currentSetupStep(facts, record);
  }
  return seen;
}

describe("currentSetupStep", () => {
  it("walks a new person in through the folder, Google and a trial", () => {
    expect(
      walk(NEW, {
        folder: { folderSettled: true, hasWorkspace: true },
        plan: { hasInstrumentPlan: true },
        "choose-ai": { hasInstrumentAccount: true, hasUsableAI: true },
      }),
    ).toMatchInlineSnapshot(`
      [
        "folder",
        "choose-ai",
        "plan",
        "model",
        "notifications",
        "look",
      ]
    `);
  });

  it("walks a new person in through ChatGPT, offering the free account", () => {
    expect(
      walk(NEW, {
        folder: { folderSettled: true, hasWorkspace: true },
        "choose-ai": { hasUsableAI: true },
      }),
    ).toMatchInlineSnapshot(`
      [
        "folder",
        "choose-ai",
        "free-account",
        "model",
        "notifications",
        "look",
      ]
    `);
  });

  it("walks a beta tester from Welcome back through the folder move", () => {
    expect(
      walk(
        {
          ...NEW,
          hasChats: true,
          hasUsableAI: true,
          hasWorkspace: true,
          testedBefore: true,
        },
        { folder: { folderSettled: true } },
      ),
    ).toMatchInlineSnapshot(`
      [
        "welcome-back",
        "folder",
        "free-account",
        "model",
        "notifications",
        "look",
      ]
    `);
  });

  it("asks only the folder while there is no workspace, whatever the record says", () => {
    const finished = finishedRecord(EMPTY, AT);
    expect(currentSetupStep(NEW, finished)).toBe("folder");
    expect(isNewStepOnly(NEW, finished)).toBe(false);
    expect(
      currentSetupStep(
        { ...NEW, hasUsableAI: true, testedBefore: true },
        EMPTY,
      ),
    ).toBe("folder");
    expect(currentSetupStep(PLACED, finished)).toBeNull();
  });

  // Each row is a relaunch: the facts as they stand, and the steps answered
  // before the quit. Setup picks up at the step the person quit on.
  it.each<[string, Partial<SetupFacts>, SetupRecord, null | string]>([
    ["quit on the first page", {}, EMPTY, "folder"],
    ["quit after placing the folder", PLACED, answered("folder"), "choose-ai"],
    [
      "quit after connecting ChatGPT",
      { ...PLACED, hasUsableAI: true },
      answered("folder"),
      "free-account",
    ],
    [
      "quit after signing in with Google, before a plan",
      { ...PLACED, hasInstrumentAccount: true, hasUsableAI: true },
      answered("folder"),
      "plan",
    ],
    [
      "quit after starting a trial",
      {
        ...PLACED,
        hasInstrumentAccount: true,
        hasInstrumentPlan: true,
        hasUsableAI: true,
      },
      answered("folder"),
      "model",
    ],
    [
      "quit on notifications",
      { ...PLACED, hasUsableAI: true },
      answered("folder", "free-account", "model"),
      "notifications",
    ],
    [
      "quit on the look",
      { ...PLACED, hasUsableAI: true },
      answered("folder", "free-account", "model", "notifications"),
      "look",
    ],
    [
      "answered everything but never finished",
      { ...PLACED, hasUsableAI: true },
      answered("folder", "free-account", "model", "notifications", "look"),
      null,
    ],
    [
      "a beta tester's first launch",
      {
        hasChats: true,
        hasUsableAI: true,
        hasWorkspace: true,
        testedBefore: true,
      },
      EMPTY,
      "welcome-back",
    ],
    [
      "a beta tester who quit after Welcome back",
      {
        hasChats: true,
        hasUsableAI: true,
        hasWorkspace: true,
        testedBefore: true,
      },
      answered("welcome-back"),
      "folder",
    ],
    [
      "a beta tester while the folder move waits on its restart",
      {
        ...PLACED,
        hasChats: true,
        hasUsableAI: true,
        testedBefore: true,
      },
      answered("welcome-back"),
      "free-account",
    ],
    [
      "a beta tester signed out of everything",
      { ...PLACED, hasChats: true, testedBefore: true },
      answered("welcome-back"),
      "choose-ai",
    ],
    [
      "a release user's chats on a second computer",
      { ...PLACED, hasChats: true, hasUsableAI: true },
      EMPTY,
      "free-account",
    ],
    [
      "lost every AI before finishing",
      PLACED,
      answered("folder", "free-account", "model"),
      "choose-ai",
    ],
    [
      "notifications off macOS",
      { ...PLACED, hasUsableAI: true, notificationsAskable: false },
      answered("folder", "free-account", "model"),
      "look",
    ],
    [
      "folder kept in app data for now",
      { hasUsableAI: true, hasWorkspace: true },
      answered("folder", "free-account", "model"),
      "notifications",
    ],
  ])("%s", (_name, facts, record, expected) => {
    expect(currentSetupStep({ ...NEW, ...facts }, record)).toBe(expected);
    expect(isNewStepOnly({ ...NEW, ...facts }, record)).toBe(false);
  });

  it("asks the plan step only of an Instrument account without a plan", () => {
    const withAccount = {
      ...PLACED,
      hasInstrumentAccount: true,
      hasUsableAI: true,
    };
    expect(currentSetupStep(withAccount, EMPTY)).toBe("plan");
    expect(
      currentSetupStep({ ...withAccount, hasInstrumentPlan: true }, EMPTY),
    ).toBe("model");
    expect(currentSetupStep({ ...PLACED, hasUsableAI: true }, EMPTY)).toBe(
      "free-account",
    );
  });

  it("skips the plan for an Instrument account beside a key or subscription of its own", () => {
    expect(
      currentSetupStep(
        {
          ...PLACED,
          hasInstrumentAccount: true,
          hasOwnAI: true,
          hasUsableAI: true,
        },
        EMPTY,
      ),
    ).toBe("model");
  });
});

describe("after finishing", () => {
  const finished = finishedRecord(answered("free-account", "model"), AT);

  it.each<[string, Partial<SetupFacts>]>([
    ["everything as it was", { hasUsableAI: true }],
    ["signed out of everything", {}],
    ["folder back in app data", { folderSettled: false, hasUsableAI: true }],
    ["tested before", { hasChats: true, testedBefore: true }],
    [
      "an Instrument account without a plan",
      { hasInstrumentAccount: true, hasUsableAI: true },
    ],
  ])("stays closed with %s", (_name, facts) => {
    expect(currentSetupStep({ ...PLACED, ...facts }, finished)).toBeNull();
    expect(isNewStepOnly({ ...PLACED, ...facts }, finished)).toBe(false);
  });

  it("shows only a step a later build added", () => {
    // Finished on a build that had no notifications step.
    const { notifications: _added, ...older } = finished.answered;
    const record = { ...finished, answered: older };
    const facts = { ...PLACED, hasUsableAI: true };
    expect(currentSetupStep(facts, record)).toBe("notifications");
    expect(isNewStepOnly(facts, record)).toBe(true);
    // The added step still has to be one the person can do here.
    expect(
      currentSetupStep({ ...facts, notificationsAskable: false }, record),
    ).toBeNull();
    // Answering it closes setup again.
    expect(
      currentSetupStep(facts, answeredStep(record, "notifications", AT)),
    ).toBeNull();
  });

  it("never brings Welcome back once finished", () => {
    const { "welcome-back": _added, ...older } = finished.answered;
    expect(
      currentSetupStep(
        { ...PLACED, hasChats: true, testedBefore: true },
        { ...finished, answered: older },
      ),
    ).toBeNull();
  });
});

describe("the record", () => {
  it("answers every step at finishing, keeping earlier times", () => {
    const record = finishedRecord(
      answeredStep(
        {
          answered: { "a-step-from-a-newer-build": "2026-01-01T00:00:00.000Z" },
        },
        "model",
        new Date("2026-10-01T00:00:00.000Z"),
      ),
      AT,
    );
    expect(record).toMatchInlineSnapshot(`
      {
        "answered": {
          "a-step-from-a-newer-build": "2026-01-01T00:00:00.000Z",
          "choose-ai": "2026-10-21T12:00:00.000Z",
          "folder": "2026-10-21T12:00:00.000Z",
          "free-account": "2026-10-21T12:00:00.000Z",
          "look": "2026-10-21T12:00:00.000Z",
          "model": "2026-10-01T00:00:00.000Z",
          "notifications": "2026-10-21T12:00:00.000Z",
          "plan": "2026-10-21T12:00:00.000Z",
          "welcome-back": "2026-10-21T12:00:00.000Z",
        },
        "finishedAt": "2026-10-21T12:00:00.000Z",
      }
    `);
    expect(isEveryStepAnswered(record)).toBe(true);
    expect(isEveryStepAnswered(EMPTY)).toBe(false);
  });

  it("keeps the first finishing time", () => {
    const first = finishedRecord(EMPTY, AT);
    expect(
      finishedRecord(first, new Date("2027-01-01T00:00:00.000Z")).finishedAt,
    ).toBe(AT.toISOString());
  });
});

describe("placing a first launch's workspace", () => {
  // A new person picked a folder that already holds a workspace with a beta
  // tester's chats. Placed, the facts are that workspace's: used before.
  const OPENED: SetupFacts = {
    ...PLACED,
    hasChats: true,
    testedBefore: true,
  };

  it("would greet them with Welcome back before the folder they just picked", () => {
    expect(currentSetupStep(OPENED, EMPTY)).toBe("welcome-back");
  });

  it("goes on to choosing AI, past Welcome back and the folder", () => {
    expect(currentSetupStep(OPENED, answeredByPlacing(EMPTY, AT))).toBe(
      "choose-ai",
    );
    // Back from there greets them, as any tester's Back does; the folder,
    // placed, is never asked again.
    expect(stepBefore(OPENED, answeredByPlacing(EMPTY, AT), "choose-ai")).toBe(
      "welcome-back",
    );
    expect(
      stepBefore(PLACED, answeredByPlacing(EMPTY, AT), "choose-ai"),
    ).toBeNull();
  });

  it("keeps a Welcome back answered earlier, and answers the folder", () => {
    const earlier = answeredStep(
      EMPTY,
      "welcome-back",
      new Date("2026-10-01T00:00:00.000Z"),
    );
    expect(answeredByPlacing(earlier, AT)).toMatchInlineSnapshot(`
      {
        "answered": {
          "folder": "2026-10-21T12:00:00.000Z",
          "welcome-back": "2026-10-01T00:00:00.000Z",
        },
      }
    `);
  });
});

describe("setupStateFrom", () => {
  it("hides setup under SKIP_ONBOARDING without changing the facts", () => {
    expect(setupStateFrom({ facts: NEW, record: EMPTY, skip: true }))
      .toMatchInlineSnapshot(`
        {
          "back": null,
          "facts": {
            "folderSettled": false,
            "hasChats": false,
            "hasInstrumentAccount": false,
            "hasInstrumentPlan": false,
            "hasOwnAI": false,
            "hasUsableAI": false,
            "hasWorkspace": false,
            "isCheckingPlan": false,
            "lostFolder": null,
            "notificationsAskable": true,
            "testedBefore": false,
          },
          "isNewStepOnly": false,
          "step": null,
        }
      `);
    expect(
      setupStateFrom({ facts: NEW, record: EMPTY, skip: false }).step,
    ).toBe("folder");
  });
});

describe("stepBefore", () => {
  const signedIn: SetupFacts = {
    ...PLACED,
    hasInstrumentAccount: true,
    hasInstrumentPlan: true,
    hasUsableAI: true,
  };

  it("passes over a step a fact settled and one not needed", () => {
    // The plan was answered before a trial made it unneeded; choose-ai keeps
    // no answer at all, and the placed folder is settled.
    const record = answered("folder", "plan", "model");
    expect(stepBefore(signedIn, record, "notifications")).toBe("model");
    expect(stepBefore(signedIn, record, "model")).toBeNull();
  });

  it("goes back from the folder to Welcome back, and from choosing AI past a moved folder", () => {
    const tester = { ...PLACED, hasChats: true, testedBefore: true };
    const record = answered("welcome-back");
    expect(
      stepBefore({ ...tester, folderSettled: false }, record, "folder"),
    ).toBe("welcome-back");
    expect(stepBefore(tester, record, "choose-ai")).toBe("welcome-back");
  });

  it("goes back to an answered step that would ask again", () => {
    const keyOnly = { ...PLACED, hasUsableAI: true };
    const record = answered("free-account");
    expect(stepBefore(keyOnly, record, "model")).toBe("free-account");
    expect(
      currentSetupStep(keyOnly, unansweredStep(record, "free-account")),
    ).toBe("free-account");
  });

  it("has nowhere to go once setup finished", () => {
    const record = { ...answered("model"), finishedAt: AT.toISOString() };
    expect(stepBefore(signedIn, record, "notifications")).toBeNull();
  });
});

describe("a record an earlier build wrote", () => {
  it("counts the way-in answer as choose-ai's, keeping the old key", () => {
    const record = SetupRecordSchema.parse({
      answered: { "way-in": AT.toISOString() },
      finishedAt: AT.toISOString(),
    });
    expect(record.answered).toMatchInlineSnapshot(`
      {
        "choose-ai": "2026-10-21T12:00:00.000Z",
        "way-in": "2026-10-21T12:00:00.000Z",
      }
    `);
    expect(isEveryStepAnswered(record)).toBe(false);
  });
});
